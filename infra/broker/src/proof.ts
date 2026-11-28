import { BrokerError } from "./errors.ts";

export const PROOF_TYP = "majord-address+jwt";
export const PROOF_AUDIENCE = "majord-broker";
const MAX_LIFETIME_SECONDS = 300;
const MAX_ISSUED_AHEAD_SECONDS = 300;
// An Ed25519 SPKI is always 44 bytes, so the DER bytes are a canonical identity.
const ED25519_SPKI_BYTES = 44;

export type ProofAction = "claim" | "release" | "push";

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  return decodeBase64(value.replaceAll("-", "+").replaceAll("_", "/"));
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

function decodeSpkiPem(pem: string): Uint8Array<ArrayBuffer> | null {
  const match = /^-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----$/u.exec(
    pem.trim(),
  );
  const body = match?.[1];
  if (body === undefined) return null;
  const der = decodeBase64(body.replaceAll(/\s/gu, ""));
  return der?.length === ED25519_SPKI_BYTES ? der : null;
}

const invalidProof = (message: string) => new BrokerError("invalid_proof", message);

/**
 * Verifies the proof and returns the caller's identity. `port` and `sha` (what a push proof says
 * its message hashes to) are unvalidated.
 */
export async function verifyProof(input: {
  readonly publicKey: string;
  readonly proof: string;
  readonly action: ProofAction;
  readonly nowSeconds: number;
}): Promise<{ readonly identity: string; readonly port: unknown; readonly sha: unknown }> {
  const der = decodeSpkiPem(input.publicKey);
  if (der === null) {
    throw new BrokerError(
      "invalid_request",
      "publicKey must be an Ed25519 public key in SPKI PEM.",
    );
  }
  const parts = input.proof.split(".");
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  if (
    parts.length !== 3 ||
    encodedHeader === undefined ||
    encodedClaims === undefined ||
    encodedSignature === undefined
  ) {
    throw invalidProof("The proof is not a compact JWS.");
  }
  const header = decodeJsonObject(encodedHeader);
  const claims = decodeJsonObject(encodedClaims);
  const signature = decodeBase64Url(encodedSignature);
  if (header === null || claims === null || signature === null) {
    throw invalidProof("The proof is not a compact JWS.");
  }
  if (header.alg !== "EdDSA" || header.typ !== PROOF_TYP || header.crit !== undefined) {
    throw invalidProof("The proof has the wrong type or algorithm.");
  }

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, false, ["verify"]);
  } catch {
    throw new BrokerError(
      "invalid_request",
      "publicKey must be an Ed25519 public key in SPKI PEM.",
    );
  }
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`);
  if (!(await crypto.subtle.verify({ name: "Ed25519" }, key, signature, signed))) {
    throw invalidProof("The proof was not signed by publicKey.");
  }

  const { aud, act, iat, exp } = claims;
  if (aud !== PROOF_AUDIENCE || act !== input.action) {
    throw invalidProof("The proof was made for something else.");
  }
  if (typeof iat !== "number" || typeof exp !== "number") {
    throw invalidProof("The proof has no issue or expiry time.");
  }
  if (
    !(exp > input.nowSeconds) ||
    !(exp - iat <= MAX_LIFETIME_SECONDS) ||
    !(iat <= input.nowSeconds + MAX_ISSUED_AHEAD_SECONDS)
  ) {
    throw invalidProof(
      "The proof has expired or is valid for too long. Check this computer's clock.",
    );
  }

  const digest = await crypto.subtle.digest("SHA-256", der);
  const identity = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { identity, port: claims.port, sha: claims.sha };
}
