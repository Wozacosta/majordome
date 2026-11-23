import type { AccountKey } from "./accountToken.ts";

export const TEST_ISSUER = "https://clerk.majordome.test";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** An account service with one signing key, as the real one publishes it. */
export async function makeAccountIssuer(keyId = "key-1") {
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
  const { n, e } = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicKey: AccountKey = { kty: "RSA", kid: keyId, n, e };
  return {
    keys: [publicKey],
    /** A token as the "majordome" template makes it; `claims` replaces or removes any claim. */
    sign: async (
      nowSeconds: number,
      claims: Record<string, unknown> = {},
      header: Record<string, unknown> = {},
    ) => {
      const signed = `${encode({ alg: "RS256", typ: "JWT", kid: keyId, ...header })}.${encode({
        iss: TEST_ISSUER,
        aud: "majordome",
        sub: "user_owner",
        email: "owner@example.com",
        iat: nowSeconds,
        nbf: nowSeconds - 5,
        exp: nowSeconds + 60,
        ...claims,
      })}`;
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        pair.privateKey,
        new TextEncoder().encode(signed),
      );
      return `${signed}.${Buffer.from(signature).toString("base64url")}`;
    },
  };
}
