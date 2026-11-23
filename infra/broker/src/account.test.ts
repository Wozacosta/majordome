import { describe, expect, it } from "vite-plus/test";

import { type AccountKey, makeAccountVerifier, verifyAccountToken } from "./account.ts";
import { BrokerError } from "./errors.ts";
import { accountPageCors } from "./worker.ts";

const ISSUER = "https://clerk.majordome.test";
const NOW = 1_800_000_000;

const encode = (value: unknown) =>
  btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

async function makeIssuer(keyId = "key-1") {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const { n, e } = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as AccountKey;
  const keys: ReadonlyArray<AccountKey> = [{ kty: "RSA", kid: keyId, n, e }];
  const sign = async (claims: Record<string, unknown> = {}) => {
    const signed = `${encode({ alg: "RS256", kid: keyId })}.${encode({
      iss: ISSUER,
      aud: "majordome",
      sub: "user_owner",
      iat: NOW,
      nbf: NOW - 5,
      exp: NOW + 60,
      ...claims,
    })}`;
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        pair.privateKey,
        new TextEncoder().encode(signed),
      ),
    );
    return `${signed}.${btoa(String.fromCharCode(...signature))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")}`;
  };
  return { keys, sign };
}

const codeOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => null,
    (error: unknown) => (error instanceof BrokerError ? error.code : String(error)),
  );

describe("account tokens", () => {
  it("names the account of a token the account service signed for Majordome", async () => {
    const issuer = await makeIssuer();
    expect(
      await verifyAccountToken({
        token: await issuer.sign(),
        keys: issuer.keys,
        issuer: ISSUER,
        nowSeconds: NOW,
      }),
    ).toBe("user_owner");
  });

  it.each([
    ["made for another service", { aud: "t3-code-relay" }],
    ["from another account service", { iss: "https://clerk.other.test" }],
    ["that has expired", { iat: NOW - 200, nbf: NOW - 200, exp: NOW - 140 }],
    ["that lives for a day", { exp: NOW + 86_400 }],
    ["with no account", { sub: "" }],
  ])("refuses a token %s", async (_name, claims) => {
    const issuer = await makeIssuer();
    expect(
      await codeOf(
        verifyAccountToken({
          token: await issuer.sign(claims),
          keys: issuer.keys,
          issuer: ISSUER,
          nowSeconds: NOW,
        }),
      ),
    ).toBe("invalid_account");
  });

  it("refuses a token someone else signed, and reads new keys at most once a minute", async () => {
    const issuer = await makeIssuer();
    const impostor = await makeIssuer();
    let now = NOW * 1000;
    let fetches = 0;
    const verify = makeAccountVerifier({
      issuer: ISSUER,
      now: () => now,
      fetchKeys: async () => {
        fetches += 1;
        return issuer.keys;
      },
    });

    expect(await verify(await issuer.sign())).toBe("user_owner");
    expect(await codeOf(verify(await impostor.sign()))).toBe("invalid_account");
    expect(await codeOf(verify(await impostor.sign()))).toBe("invalid_account");
    expect(fetches).toBe(1);

    now += 61_000;
    expect(
      await codeOf(verify(await impostor.sign({ iat: NOW + 61, nbf: NOW + 56, exp: NOW + 121 }))),
    ).toBe("invalid_account");
    expect(fetches).toBe(2);
  });
});

describe("accountPageCors", () => {
  it("answers the sign-in site and no other", () => {
    expect(accountPageCors("https://majord.me", "https://majord.me")).toMatchObject({
      "access-control-allow-origin": "https://majord.me",
    });
    expect(accountPageCors("https://evil.example", "https://majord.me")).toEqual({});
    expect(accountPageCors(null, "https://majord.me")).toEqual({});
    expect(accountPageCors("https://majord.me", undefined)).toEqual({});
  });
});
