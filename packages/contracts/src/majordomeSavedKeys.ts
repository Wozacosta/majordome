import * as Schema from "effect/Schema";

import { IsoDateTime } from "./baseSchemas.ts";
import { SecretReference } from "./secretReference.ts";

export const MAJORDOME_SAVED_KEY_NOTE_MAX = 200;
export const MAJORDOME_SAVED_KEY_VALUE_MAX = 64 * 1024;

/** As the server's key file names a secret: it is also typed on a command line. */
export const MajordomeSavedKeyName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
);

/** Whether `value` is a real calendar day written `2027-11-25`. */
export function isCalendarDay(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (parts === null) return false;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return days !== undefined && day >= 1 && day <= days;
}

/** The last day a key works, as its owner said. */
export const MajordomeSavedKeyDay = Schema.String.check(
  Schema.makeFilter((value) => isCalendarDay(value), { expected: "a day written YYYY-MM-DD" }),
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
  /** The last day the key works, when the owner said. Nothing stops a key used after it. */
  expiresOn: Schema.optional(MajordomeSavedKeyDay),
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
  /**
   * The last day the key works; null for no end date. A new key without one has none. Given
   * with neither `value` nor `reference`, it changes the date of the key already saved.
   */
  expiresOn: Schema.optional(Schema.NullOr(MajordomeSavedKeyDay)),
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
