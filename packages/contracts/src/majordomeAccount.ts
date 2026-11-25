import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** The Majordome account a server belongs to. */
export const MajordomeAccountOwner = Schema.Struct({
  accountId: Schema.String,
  /** The account's email when the sign-in carried one. */
  email: Schema.NullOr(Schema.String),
});
export type MajordomeAccountOwner = typeof MajordomeAccountOwner.Type;

export const MajordomeAccount = Schema.Struct({
  /** False on a build with no account service; the screens then stay hidden. */
  available: Schema.Boolean,
  owner: Schema.NullOr(MajordomeAccountOwner),
  /** True on a server Majordome hosts: its account was set when it was made and cannot change. */
  fixed: Schema.Boolean,
  /** Where the account's other devices reach this server, or null when it has no such address. */
  address: Schema.NullOr(Schema.String),
  /**
   * Given only in the answer to adding the account: what a device shows beside its account token
   * to sign in here. A token alone could be replayed by another server it was shown to.
   */
  signInKey: Schema.optional(Schema.String),
});
export type MajordomeAccount = typeof MajordomeAccount.Type;

/** A fresh token from the account service's "majordome" template. */
export const MajordomeAccountTokenInput = Schema.Struct({
  token: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
});
export type MajordomeAccountTokenInput = typeof MajordomeAccountTokenInput.Type;

/** What a device with no session sends: the token, and the key the account lists for the server. */
export const MajordomeAccountSignInInput = Schema.Struct({
  token: MajordomeAccountTokenInput.fields.token,
  key: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
});
export type MajordomeAccountSignInInput = typeof MajordomeAccountSignInInput.Type;

export const MajordomeAccountErrorReason = Schema.Literals([
  /** This build has no account service. */
  "unavailable",
  /** The token is not one the account service made for Majordome just now. */
  "invalid-token",
  /** The token was already used to sign in. */
  "used-token",
  /** The device did not show this server's sign-in key, or showed an old one. */
  "wrong-key",
  /** The server belongs to another account, or to none. */
  "not-owner",
  /** A hosted server's account cannot be removed. */
  "fixed",
  "failed",
]);
export type MajordomeAccountErrorReason = typeof MajordomeAccountErrorReason.Type;

export class MajordomeAccountError extends Schema.TaggedError<MajordomeAccountError>()(
  "MajordomeAccountError",
  {
    reason: MajordomeAccountErrorReason,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** What a signed-in device gets: the one-time credential a pairing link carries. */
export const MajordomeAccountSignIn = Schema.Struct({
  credential: Schema.String,
  expiresAt: Schema.DateTimeUtc,
});
export type MajordomeAccountSignIn = typeof MajordomeAccountSignIn.Type;

/** Where a signed-in device asks a server for its credential; the body is the sign-in input. */
export const MAJORDOME_ACCOUNT_SIGN_IN_PATH = "/api/majordome/account/sign-in";
