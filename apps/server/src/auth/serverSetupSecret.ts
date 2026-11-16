/**
 * The secret "Set up a server for me" hands a new server through its environment, so the computer
 * that created it can pair with no one typing a code. It works once, and it carries its own expiry
 * so a server whose state was wiped cannot be talked into accepting it again later.
 */

import * as DateTime from "effect/DateTime";

/** Where the new server reads the secret from. */
export const SERVER_SETUP_SECRET_VARIABLE = "MAJORDOME_SETUP_SECRET";
export const SERVER_SETUP_SUBJECT = "server-setup";

const PREFIX = "mjsetup";
const SECRET_PATTERN = /^mjsetup-(\d{1,12})-[A-Za-z0-9_-]{43}$/;

/** `random` is 32 bytes from a secure source. */
export function formatServerSetupSecret(input: {
  readonly expiresAt: DateTime.Utc;
  readonly random: Uint8Array;
}): string {
  const seconds = Math.floor(input.expiresAt.epochMilliseconds / 1_000);
  return `${PREFIX}-${seconds}-${Buffer.from(input.random).toString("base64url")}`;
}

/** When a well-formed secret stops working; undefined for anything else. */
export function serverSetupSecretExpiry(secret: string): DateTime.Utc | undefined {
  const seconds = SECRET_PATTERN.exec(secret)?.[1];
  return seconds === undefined ? undefined : DateTime.makeUnsafe(Number(seconds) * 1_000);
}
