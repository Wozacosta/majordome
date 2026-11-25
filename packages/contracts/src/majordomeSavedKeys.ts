import * as Schema from "effect/Schema";

import { IsoDateTime } from "./baseSchemas.ts";
import { SecretReference } from "./secretReference.ts";

export const MAJORDOME_SAVED_KEY_NOTE_MAX = 200;
export const MAJORDOME_SAVED_KEY_VALUE_MAX = 64 * 1024;

/** As the server's key file names a secret: it is also typed on a command line. */
export const MajordomeSavedKeyName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
);

const Note = Schema.String.check(Schema.isMaxLength(MAJORDOME_SAVED_KEY_NOTE_MAX));

/** A key the assistant may use on this server. The value never leaves the server. */
export const MajordomeSavedKey = Schema.Struct({
  name: Schema.String,
  /** What the key is for, in the owner's words. Empty for a key saved from the terminal. */
  note: Schema.String,
  /** Absent for a key saved from the terminal. */
  addedAt: Schema.optional(IsoDateTime),
  /** The last time an assistant took the key for a command. */
  lastUsedAt: Schema.optional(IsoDateTime),
  /** The name of the secret source the key is read from, for a key Majordome holds no copy of. */
  source: Schema.optional(Schema.String),
  /** The name of the secret source this key signs Majordome in to. An assistant cannot take it. */
  signsInTo: Schema.optional(Schema.String),
});
export type MajordomeSavedKey = typeof MajordomeSavedKey.Type;

export const MajordomeSavedKeysResult = Schema.Struct({
  /** By name. */
  keys: Schema.Array(MajordomeSavedKey),
});
export type MajordomeSavedKeysResult = typeof MajordomeSavedKeysResult.Type;

export const MajordomeSaveKeyInput = Schema.Struct({
  name: MajordomeSavedKeyName,
  note: Schema.optional(Note),
  /** The key itself, kept in the server's key file. Give this or `reference`. */
  value: Schema.optional(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAJORDOME_SAVED_KEY_VALUE_MAX)),
  ),
  /** Where the key is in a secret source; it is read from there each time it is used. */
  reference: Schema.optional(SecretReference),
});
export type MajordomeSaveKeyInput = typeof MajordomeSaveKeyInput.Type;

export const MajordomeRemoveSavedKeyInput = Schema.Struct({ name: Schema.String });
export type MajordomeRemoveSavedKeyInput = typeof MajordomeRemoveSavedKeyInput.Type;

/** `message` is written for the owner. */
export class MajordomeSavedKeysError extends Schema.TaggedError<MajordomeSavedKeysError>()(
  "MajordomeSavedKeysError",
  { message: Schema.String },
) {}
