/**
 * Checks the token a signed-in Majordome account sends this server. The account service (Clerk)
 * signs it with a key this server reads from the service's public key list, so the server holds
 * no secret of the account service.
 */

/** The `aud` the account service's "majordome" token template carries. */
const ACCOUNT_TOKEN_AUDIENCE = "majordome";
// A token is a bearer key until it expires, so a template set up with a long life is refused.
const MAX_LIFETIME_SECONDS = 300;
const CLOCK_LEEWAY_SECONDS = 30;

export type AccountTokenRefusal =
  | "malformed"
  | "unknown-key"
  | "bad-signature"
  | "wrong-issuer"
  | "wrong-audience"
  | "expired";

/** One of the account service's public keys, as its key list gives it. */
export interface AccountKey {
  readonly kty: string;
  readonly kid?: string | undefined;
  readonly n?: string | undefined;
  readonly e?: string | undefined;
}

export type AccountTokenCheck =
  | {
      readonly ok: true;
      readonly accountId: string;
      readonly email: string | null;
      readonly expiresAtSeconds: number;
    }
  | { readonly ok: false; readonly reason: AccountTokenRefusal };

const refused = (reason: AccountTokenRefusal): AccountTokenCheck => ({ ok: false, reason });

function decodeJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function verifyAccountToken(input: {
  readonly token: string;
  readonly keys: ReadonlyArray<AccountKey>;
  readonly issuer: string;
  readonly nowSeconds: number;
}): Promise<AccountTokenCheck> {
  const parts = input.token.split(".");
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  if (
    parts.length !== 3 ||
    encodedHeader === undefined ||
    encodedClaims === undefined ||
    encodedSignature === undefined
  ) {
    return refused("malformed");
  }
  const header = decodeJsonObject(encodedHeader);
  const claims = decodeJsonObject(encodedClaims);
  if (header === null || claims === null || header.alg !== "RS256" || header.crit !== undefined) {
    return refused("malformed");
  }
  const jwk = input.keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (jwk?.n === undefined || jwk.e === undefined) return refused("unknown-key");

  let valid: boolean;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      Buffer.from(encodedSignature, "base64url"),
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) return refused("bad-signature");

  const { iss, aud, sub, iat, exp, nbf, email } = claims;
  if (iss !== input.issuer) return refused("wrong-issuer");
  if (aud !== ACCOUNT_TOKEN_AUDIENCE) return refused("wrong-audience");
  if (typeof sub !== "string" || sub === "" || typeof iat !== "number" || typeof exp !== "number") {
    return refused("malformed");
  }
  if (
    exp - iat > MAX_LIFETIME_SECONDS ||
    exp + CLOCK_LEEWAY_SECONDS <= input.nowSeconds ||
    (typeof nbf === "number" ? nbf : iat) > input.nowSeconds + CLOCK_LEEWAY_SECONDS
  ) {
    return refused("expired");
  }
  return {
    ok: true,
    accountId: sub,
    email: typeof email === "string" && email !== "" ? email : null,
    expiresAtSeconds: exp,
  };
}
