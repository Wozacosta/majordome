import { describe, expect, it } from "@effect/vitest";
import type { MajordomeAccountOwner } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { makeAccountIssuer, TEST_ISSUER } from "./accountToken.testkit.ts";
import { type AccountDeps, makeAccount } from "./MajordomeAccount.ts";

const NOW_SECONDS = 1_800_000_000;

const setup = Effect.fn(function* (options: Partial<AccountDeps> = {}) {
  yield* TestClock.setTime(NOW_SECONDS * 1_000);
  const issuer = yield* Effect.promise(() => makeAccountIssuer());
  const owner = yield* Ref.make<MajordomeAccountOwner | null>(null);
  const issued = yield* Ref.make<ReadonlyArray<string>>([]);
  const revoked = yield* Ref.make(0);
  const keyFetches = yield* Ref.make(0);
  const signInKey = yield* Ref.make<string | null>(null);
  const account = yield* makeAccount({
    issuer: TEST_ISSUER,
    fixedOwnerId: null,
    fetchKeys: Ref.update(keyFetches, (count) => count + 1).pipe(Effect.as(issuer.keys)),
    readOwner: Ref.get(owner),
    writeOwner: (next) => Ref.set(owner, next),
    issueCredential: (signedIn) =>
      Ref.update(issued, (all) => [...all, signedIn.accountId]).pipe(
        Effect.as({
          credential: "one-time",
          expiresAt: DateTime.makeUnsafe((NOW_SECONDS + 120) * 1_000),
        }),
      ),
    revokeAccountSessions: Ref.update(revoked, (count) => count + 1),
    signInKey: {
      read: Ref.get(signInKey),
      readOrMake: Ref.updateAndGet(signInKey, (key) => key ?? "c2VydmVyLWtleQ").pipe(
        Effect.map((key) => key ?? "c2VydmVyLWtleQ"),
      ),
      forget: Ref.set(signInKey, null),
    },
    address: Effect.succeed("https://k7m2xq9d.majord.link"),
    ...options,
  });
  const token = (claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) =>
    Effect.promise(() => issuer.sign(NOW_SECONDS, claims, header));
  return { account, token, issued, revoked, keyFetches };
});

const reasonOf = <A>(effect: Effect.Effect<A, { readonly reason: string }>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

describe("MajordomeAccount", () => {
  it.effect("lets the linked account sign in, once per token", () =>
    Effect.gen(function* () {
      const { account, token, issued } = yield* setup();
      expect(yield* account.link(yield* token())).toEqual({
        available: true,
        owner: { accountId: "user_owner", email: "owner@example.com" },
        fixed: false,
        address: "https://k7m2xq9d.majord.link",
        signInKey: "c2VydmVyLWtleQ",
      });

      const signIn = yield* token({ jti: "a" });
      expect((yield* account.signIn(signIn, "c2VydmVyLWtleQ")).credential).toBe("one-time");
      expect(yield* reasonOf(account.signIn(signIn, "c2VydmVyLWtleQ"))).toBe("used-token");
      expect(yield* Ref.get(issued)).toEqual(["user_owner"]);
    }),
  );

  it.effect("refuses a token shown without this server's key, as another server would", () =>
    Effect.gen(function* () {
      const { account, token, issued } = yield* setup();
      const added = yield* token({ jti: "added" });
      yield* account.link(added);

      expect(yield* reasonOf(account.signIn(yield* token({ jti: "a" }), null))).toBe("wrong-key");
      expect(yield* reasonOf(account.signIn(yield* token({ jti: "b" }), "b3RoZXI"))).toBe(
        "wrong-key",
      );
      expect(yield* reasonOf(account.signIn(added, "c2VydmVyLWtleQ"))).toBe("used-token");
      expect(yield* Ref.get(issued)).toEqual([]);
    }),
  );

  it.effect("refuses another account, and any account before one is linked", () =>
    Effect.gen(function* () {
      const { account, token, issued } = yield* setup();
      expect(yield* reasonOf(account.signIn(yield* token(), null))).toBe("not-owner");

      yield* account.link(yield* token());
      const stranger = yield* token({ sub: "user_stranger" });
      expect(yield* reasonOf(account.signIn(stranger, null))).toBe("not-owner");
      expect(yield* reasonOf(account.link(stranger))).toBe("not-owner");
      expect(yield* Ref.get(issued)).toEqual([]);
    }),
  );

  it.effect("ends the account's sessions and refuses it after it is removed", () =>
    Effect.gen(function* () {
      const { account, token, revoked } = yield* setup();
      yield* account.link(yield* token());
      expect((yield* account.unlink()).owner).toBeNull();
      expect(yield* Ref.get(revoked)).toBe(1);
      expect(yield* reasonOf(account.signIn(yield* token({ jti: "b" }), null))).toBe("not-owner");
    }),
  );

  it.effect("keeps the account a hosted server was made for", () =>
    Effect.gen(function* () {
      const { account, token } = yield* setup({ fixedOwnerId: "user_owner" });
      expect((yield* account.read()).owner).toEqual({ accountId: "user_owner", email: null });
      expect(yield* reasonOf(account.unlink())).toBe("fixed");
      expect(yield* reasonOf(account.link(yield* token({ sub: "user_stranger" })))).toBe(
        "not-owner",
      );
      yield* account.signIn(yield* token(), null);
      expect((yield* account.read()).owner?.email).toBe("owner@example.com");
    }),
  );

  it.effect("asks for the keys again for an unknown key, at most once a minute", () =>
    Effect.gen(function* () {
      const { account, token, keyFetches } = yield* setup();
      yield* account.link(yield* token());
      const rotated = yield* token({}, { kid: "key-2" });
      expect(yield* reasonOf(account.signIn(rotated, null))).toBe("invalid-token");
      expect(yield* reasonOf(account.signIn(rotated, null))).toBe("invalid-token");
      expect(yield* Ref.get(keyFetches)).toBe(1);
      yield* TestClock.adjust("61 seconds");
      expect(yield* reasonOf(account.signIn(rotated, null))).toBe("invalid-token");
      expect(yield* Ref.get(keyFetches)).toBe(2);
    }),
  );

  it.effect("has nothing to offer on a build with no account service", () =>
    Effect.gen(function* () {
      const { account, token } = yield* setup({ issuer: null });
      expect((yield* account.read()).available).toBe(false);
      expect(yield* reasonOf(account.signIn(yield* token(), null))).toBe("unavailable");
    }),
  );
});
