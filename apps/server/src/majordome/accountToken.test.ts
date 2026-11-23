import { describe, expect, it } from "@effect/vitest";

import { verifyAccountToken } from "./accountToken.ts";
import { makeAccountIssuer, TEST_ISSUER } from "./accountToken.testkit.ts";

const NOW = 1_800_000_000;

describe("verifyAccountToken", () => {
  it("accepts a token the account service signed for Majordome", async () => {
    const issuer = await makeAccountIssuer();
    expect(
      await verifyAccountToken({
        token: await issuer.sign(NOW),
        keys: issuer.keys,
        issuer: TEST_ISSUER,
        nowSeconds: NOW,
      }),
    ).toEqual({
      ok: true,
      accountId: "user_owner",
      email: "owner@example.com",
      expiresAtSeconds: NOW + 60,
    });
  });

  it.each([
    ["made for another service", { aud: "t3-code-relay" }, "wrong-audience"],
    ["with no audience", { aud: undefined }, "wrong-audience"],
    ["from another account service", { iss: "https://clerk.other.test" }, "wrong-issuer"],
    ["that has expired", { iat: NOW - 200, nbf: NOW - 200, exp: NOW - 140 }, "expired"],
    ["not valid yet", { iat: NOW + 120, nbf: NOW + 120, exp: NOW + 180 }, "expired"],
    ["that lives for a day", { exp: NOW + 86_400 }, "expired"],
    ["with no account", { sub: undefined }, "malformed"],
  ] as const)("refuses a token %s", async (_name, claims, reason) => {
    const issuer = await makeAccountIssuer();
    expect(
      await verifyAccountToken({
        token: await issuer.sign(NOW, claims),
        keys: issuer.keys,
        issuer: TEST_ISSUER,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason });
  });

  it("refuses a token signed by someone else under the service's key name", async () => {
    const issuer = await makeAccountIssuer();
    const impostor = await makeAccountIssuer();
    expect(
      await verifyAccountToken({
        token: await impostor.sign(NOW),
        keys: issuer.keys,
        issuer: TEST_ISSUER,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("refuses an unsigned token and a key it does not know", async () => {
    const issuer = await makeAccountIssuer();
    const check = (token: string) =>
      verifyAccountToken({ token, keys: issuer.keys, issuer: TEST_ISSUER, nowSeconds: NOW });
    const [, claims] = (await issuer.sign(NOW)).split(".");
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${claims}.`;
    expect(await check(unsigned)).toEqual({ ok: false, reason: "malformed" });
    expect(await check(await issuer.sign(NOW, {}, { kid: "key-2" }))).toEqual({
      ok: false,
      reason: "unknown-key",
    });
  });
});
