/**
 * The Majordome account this server belongs to. An account is identity only: a device signed in
 * to it shows a fresh token, and gets the one-time credential a pairing link carries. Nothing
 * here goes through T3 Connect, and the account service never holds a key to this server.
 */

import {
  AuthAdministrativeClientScopes,
  type MajordomeAccount as AccountState,
  MajordomeAccountError,
  type MajordomeAccountOwner,
  type MajordomeAccountSignIn,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { timingSafeEqualBase64Url } from "../auth/utils.ts";
import { accountIssuerConfig } from "../cloud/publicConfig.ts";
import { readPublicUrl } from "../startupAccess.ts";
import { type AccountKey, type AccountTokenCheck, verifyAccountToken } from "./accountToken.ts";
import * as AnywhereAddress from "./AnywhereAddress.ts";

/** Set on a server Majordome hosts, when it is made: the account that owns it from first boot. */
const OWNER_ACCOUNT_VARIABLE = "MAJORDOME_OWNER_ACCOUNT";
/** The subject of every session an account sign-in gives, so removing the account ends them. */
const ACCOUNT_SESSION_SUBJECT = "majordome-account";
const OWNER_SECRET = "majordome-account-owner";
const SIGN_IN_KEY_SECRET = "majordome-account-sign-in-key";
const SIGN_IN_KEY_BYTES = 32;
const SIGN_IN_CREDENTIAL_TTL = Duration.minutes(2);
const KEYS_TIMEOUT = Duration.seconds(10);
const KEYS_REFRESH_INTERVAL_MS = 60_000;

const StoredOwnerJson = Schema.fromJsonString(
  Schema.Struct({ accountId: Schema.NonEmptyString, email: Schema.NullOr(Schema.String) }),
);
const decodeStoredOwner = Schema.decodeUnknownOption(StoredOwnerJson);
const encodeStoredOwner = Schema.encodeSync(StoredOwnerJson);
const decodeKeys = Schema.decodeUnknownOption(
  Schema.Struct({
    keys: Schema.Array(
      Schema.Struct({
        kty: Schema.String,
        kid: Schema.optional(Schema.String),
        n: Schema.optional(Schema.String),
        e: Schema.optional(Schema.String),
      }),
    ),
  }),
);

const encodeKey = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const MESSAGES = {
  unavailable: "This version of Majordome has no accounts.",
  "invalid-token": "That sign-in could not be checked. Sign in again.",
  "used-token": "That sign-in was already used. Sign in again.",
  "wrong-key":
    "This device has an old entry for this server. Update Majordome here, then open Settings > Your account in Majordome on your computer.",
  "not-owner": "This server belongs to another account.",
  fixed: "This server's account was set when it was made and cannot be removed.",
  failed: "Something went wrong with the account. Try again.",
} as const;

const fail = (reason: keyof typeof MESSAGES, cause?: unknown) =>
  new MajordomeAccountError({
    reason,
    message: MESSAGES[reason],
    ...(cause === undefined ? {} : { cause }),
  });

export interface AccountDeps {
  /** The account service's address, which is also the `iss` of its tokens; null without one. */
  readonly issuer: string | null;
  readonly fixedOwnerId: string | null;
  readonly fetchKeys: Effect.Effect<ReadonlyArray<AccountKey>, MajordomeAccountError>;
  readonly readOwner: Effect.Effect<MajordomeAccountOwner | null, MajordomeAccountError>;
  readonly writeOwner: (
    owner: MajordomeAccountOwner | null,
  ) => Effect.Effect<void, MajordomeAccountError>;
  readonly issueCredential: (
    owner: MajordomeAccountOwner,
  ) => Effect.Effect<MajordomeAccountSignIn, MajordomeAccountError>;
  readonly revokeAccountSessions: Effect.Effect<void, MajordomeAccountError>;
  /** The key a signing-in device must show, made the first time an account is added. */
  readonly signInKey: {
    readonly read: Effect.Effect<string | null, MajordomeAccountError>;
    readonly readOrMake: Effect.Effect<string, MajordomeAccountError>;
    readonly forget: Effect.Effect<void, MajordomeAccountError>;
  };
  readonly address: Effect.Effect<string | null>;
}

export class MajordomeAccount extends Context.Service<
  MajordomeAccount,
  {
    readonly read: () => Effect.Effect<AccountState, MajordomeAccountError>;
    /** Makes the signed-in account this server's owner. Only from an owner session. */
    readonly link: (token: string) => Effect.Effect<AccountState, MajordomeAccountError>;
    /** Forgets the account and ends every session it gave. */
    readonly unlink: () => Effect.Effect<AccountState, MajordomeAccountError>;
    /** For a device with no session here: the owner account's token buys a pairing credential. */
    readonly signIn: (
      token: string,
      key: string | null,
    ) => Effect.Effect<MajordomeAccountSignIn, MajordomeAccountError>;
  }
>()("t3/majordome/MajordomeAccount") {}

export const makeAccount = Effect.fn("MajordomeAccount.make")(function* (deps: AccountDeps) {
  const keysRef = yield* Ref.make<{
    readonly keys: ReadonlyArray<AccountKey>;
    readonly fetchedAt: number;
  } | null>(null);
  // Tokens that already bought a credential, until they expire anyway.
  const usedRef = yield* Ref.make<ReadonlyMap<string, number>>(new Map());

  const keys = Effect.fn("MajordomeAccount.keys")(function* (refresh: boolean) {
    const cached = yield* Ref.get(keysRef);
    const now = yield* Clock.currentTimeMillis;
    // A token naming an unknown key asks for a refresh; the interval keeps that from being a
    // way to make this server hammer the account service.
    if (cached !== null && (!refresh || now - cached.fetchedAt < KEYS_REFRESH_INTERVAL_MS)) {
      return cached.keys;
    }
    const fetched = yield* deps.fetchKeys;
    yield* Ref.set(keysRef, { keys: fetched, fetchedAt: now });
    return fetched;
  });

  const verify = Effect.fn("MajordomeAccount.verify")(function* (token: string) {
    const { issuer } = deps;
    if (issuer === null) return yield* fail("unavailable");
    const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1_000);
    const check = (refresh: boolean) =>
      keys(refresh).pipe(
        Effect.flatMap((known) =>
          Effect.promise(() => verifyAccountToken({ token, keys: known, issuer, nowSeconds })),
        ),
      );
    let checked: AccountTokenCheck = yield* check(false);
    if (!checked.ok && checked.reason === "unknown-key") checked = yield* check(true);
    if (!checked.ok) {
      yield* Effect.logInfo("An account sign-in was refused.", { reason: checked.reason });
      return yield* fail("invalid-token");
    }
    return checked;
  });

  const owner = Effect.gen(function* () {
    const stored = yield* deps.readOwner;
    if (deps.fixedOwnerId === null) return stored;
    return {
      accountId: deps.fixedOwnerId,
      email: stored?.accountId === deps.fixedOwnerId ? stored.email : null,
    };
  });

  const read = Effect.fn("MajordomeAccount.read")(function* () {
    if (deps.issuer === null) {
      return { available: false, owner: null, fixed: false, address: null };
    }
    return {
      available: true,
      owner: yield* owner,
      fixed: deps.fixedOwnerId !== null,
      address: yield* deps.address,
    };
  });

  const remember = (current: MajordomeAccountOwner | null, next: MajordomeAccountOwner) =>
    current?.accountId === next.accountId && current.email === next.email
      ? Effect.void
      : deps.writeOwner(next);

  /** A token works once here, whichever of the two doors it came through. */
  const spend = Effect.fn("MajordomeAccount.spend")(function* (
    token: string,
    expiresAtSeconds: number,
  ) {
    const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1_000);
    const fresh = yield* Ref.modify(usedRef, (used) => {
      if (used.has(token)) return [false, used] as const;
      const kept = new Map(Array.from(used).filter(([, expiresAt]) => expiresAt > nowSeconds));
      // The leeway the check allows past expiry is covered by keeping the token a minute more.
      kept.set(token, expiresAtSeconds + 60);
      return [true, kept] as const;
    });
    if (!fresh) return yield* fail("used-token");
  });

  const link = Effect.fn("MajordomeAccount.link")(function* (token: string) {
    const checked = yield* verify(token);
    const current = yield* owner;
    if (current !== null && current.accountId !== checked.accountId) {
      return yield* fail("not-owner");
    }
    yield* spend(token, checked.expiresAtSeconds);
    yield* remember(current, { accountId: checked.accountId, email: checked.email });
    return { ...(yield* read()), signInKey: yield* deps.signInKey.readOrMake };
  });

  const unlink = Effect.fn("MajordomeAccount.unlink")(function* () {
    if (deps.issuer === null) return yield* fail("unavailable");
    if (deps.fixedOwnerId !== null) return yield* fail("fixed");
    yield* deps.writeOwner(null);
    yield* deps.signInKey.forget;
    yield* deps.revokeAccountSessions;
    return yield* read();
  });

  const signIn = Effect.fn("MajordomeAccount.signIn")(function* (
    token: string,
    key: string | null,
  ) {
    const checked = yield* verify(token);
    const current = yield* owner;
    if (current === null || current.accountId !== checked.accountId) {
      return yield* fail("not-owner");
    }
    // A server no app has added since keys exist has none yet, and takes the token alone.
    const expected = yield* deps.signInKey.read;
    if (expected !== null && (key === null || !timingSafeEqualBase64Url(expected, key))) {
      return yield* fail("wrong-key");
    }
    yield* spend(token, checked.expiresAtSeconds);
    const signedIn = { accountId: checked.accountId, email: checked.email };
    yield* remember(yield* deps.readOwner, signedIn);
    return yield* deps.issueCredential(signedIn);
  });

  return MajordomeAccount.of({ read, link, unlink, signIn });
});

export const layer = Layer.effect(
  MajordomeAccount,
  Effect.gen(function* () {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const http = yield* HttpClient.HttpClient;
    const anywhere = yield* AnywhereAddress.AnywhereAddress;
    const environment = yield* HostProcess.Environment;
    const publicUrl = yield* readPublicUrl;
    const issuer = yield* accountIssuerConfig.pipe(Effect.orElseSucceed(() => null));

    return yield* makeAccount({
      issuer,
      fixedOwnerId: environment[OWNER_ACCOUNT_VARIABLE]?.trim() || null,
      fetchKeys: HttpClientRequest.get(`${issuer}/.well-known/jwks.json`).pipe(
        HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "majordome" }),
        http.execute,
        Effect.flatMap((response) => response.json),
        Effect.timeout(KEYS_TIMEOUT),
        Effect.flatMap((json) => Effect.fromOption(decodeKeys(json))),
        Effect.map(({ keys }) => keys),
        Effect.mapError((cause) => fail("failed", cause)),
      ),
      readOwner: secrets.get(OWNER_SECRET).pipe(
        Effect.map((stored) =>
          Option.getOrNull(
            Option.flatMap(stored, (bytes) => decodeStoredOwner(new TextDecoder().decode(bytes))),
          ),
        ),
        Effect.mapError((cause) => fail("failed", cause)),
      ),
      writeOwner: (owner) =>
        (owner === null
          ? secrets.remove(OWNER_SECRET)
          : secrets.set(OWNER_SECRET, new TextEncoder().encode(encodeStoredOwner(owner)))
        ).pipe(Effect.mapError((cause) => fail("failed", cause))),
      issueCredential: (owner) =>
        auth
          .createPairingLink({
            ttl: SIGN_IN_CREDENTIAL_TTL,
            scopes: AuthAdministrativeClientScopes,
            subject: ACCOUNT_SESSION_SUBJECT,
            label: owner.email ?? "Majordome account",
          })
          .pipe(
            Effect.map(({ credential, expiresAt }) => ({ credential, expiresAt })),
            Effect.mapError((cause) => fail("failed", cause)),
          ),
      signInKey: {
        read: secrets.get(SIGN_IN_KEY_SECRET).pipe(
          Effect.map(Option.match({ onNone: () => null, onSome: encodeKey })),
          Effect.mapError((cause) => fail("failed", cause)),
        ),
        readOrMake: secrets.getOrCreateRandom(SIGN_IN_KEY_SECRET, SIGN_IN_KEY_BYTES).pipe(
          Effect.map(encodeKey),
          Effect.mapError((cause) => fail("failed", cause)),
        ),
        forget: secrets
          .remove(SIGN_IN_KEY_SECRET)
          .pipe(Effect.mapError((cause) => fail("failed", cause))),
      },
      revokeAccountSessions: auth.listSessions().pipe(
        Effect.flatMap((sessions) =>
          Effect.forEach(
            sessions.filter((session) => session.subject === ACCOUNT_SESSION_SUBJECT),
            (session) => auth.revokeClient(session.sessionId),
            { discard: true },
          ),
        ),
        Effect.mapError((cause) => fail("failed", cause)),
      ),
      address:
        publicUrl?.startsWith("https://") === true
          ? Effect.succeed(publicUrl)
          : anywhere.read().pipe(
              Effect.map((address) => (address.state === "ready" ? address.url : null)),
              Effect.orElseSucceed(() => null),
            ),
    });
  }),
);
