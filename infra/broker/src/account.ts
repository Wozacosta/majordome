import { BrokerError } from "./errors.ts";

/**
 * Checks the token of a signed-in Majordome account, the same way a Majordome server does
 * (`apps/server/src/majordome/accountToken.ts`): against the account service's public keys.
 */

const AUDIENCE = "majordome";
const MAX_LIFETIME_SECONDS = 300;
const CLOCK_LEEWAY_SECONDS = 30;
const KEYS_REFRESH_INTERVAL_MS = 60_000;

export interface AccountKey {
  readonly kty?: string | undefined;
  readonly kid?: string | undefined;
  readonly n?: string | undefined;
  readonly e?: string | undefined;
}

const refuse = () =>
  new BrokerError("invalid_account", "That sign-in could not be checked. Sign in again.");

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeJsonObject(value: string): Record<string, unknown> | null {
  const bytes = decodeBase64Url(value);
  if (bytes === null) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The account the token is for. Throws `invalid_account` for anything else. */
export async function verifyAccountToken(input: {
  readonly token: string;
  readonly keys: ReadonlyArray<AccountKey>;
  readonly issuer: string;
  readonly nowSeconds: number;
}): Promise<string> {
  const parts = input.token.split(".");
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  if (
    parts.length !== 3 ||
    encodedHeader === undefined ||
    encodedClaims === undefined ||
    encodedSignature === undefined
  ) {
    throw refuse();
  }
  const header = decodeJsonObject(encodedHeader);
  const claims = decodeJsonObject(encodedClaims);
  const signature = decodeBase64Url(encodedSignature);
  if (header === null || claims === null || signature === null || header.alg !== "RS256") {
    throw refuse();
  }
  const jwk = input.keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (jwk?.n === undefined || jwk.e === undefined) throw refuse();

  const valid = await crypto.subtle
    .importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    )
    .then((key) =>
      crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        signature,
        new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
      ),
    )
    .catch(() => false);
  if (!valid) throw refuse();

  const { iss, aud, sub, iat, exp, nbf } = claims;
  if (
    iss !== input.issuer ||
    aud !== AUDIENCE ||
    typeof sub !== "string" ||
    sub === "" ||
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    exp - iat > MAX_LIFETIME_SECONDS ||
    exp + CLOCK_LEEWAY_SECONDS <= input.nowSeconds ||
    (typeof nbf === "number" ? nbf : iat) > input.nowSeconds + CLOCK_LEEWAY_SECONDS
  ) {
    throw refuse();
  }
  return sub;
}

/** Reads the account service's keys once, and again at most once a minute for an unknown key. */
export function makeAccountVerifier(deps: {
  readonly issuer: string;
  readonly fetchKeys: () => Promise<ReadonlyArray<AccountKey>>;
  readonly now: () => number;
}) {
  let cached: { readonly keys: ReadonlyArray<AccountKey>; readonly fetchedAt: number } | null =
    null;
  const keys = async (refresh: boolean) => {
    const now = deps.now();
    if (cached !== null && (!refresh || now - cached.fetchedAt < KEYS_REFRESH_INTERVAL_MS)) {
      return cached.keys;
    }
    cached = { keys: await deps.fetchKeys(), fetchedAt: now };
    return cached.keys;
  };
  return async (token: string): Promise<string> => {
    const check = async (refresh: boolean) =>
      verifyAccountToken({
        token,
        keys: await keys(refresh),
        issuer: deps.issuer,
        nowSeconds: Math.floor(deps.now() / 1000),
      });
    return check(false).catch(() => check(true));
  };
}
