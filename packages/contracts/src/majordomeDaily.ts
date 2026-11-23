import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";
import { MajordomeNoteSaveRefusal } from "./majordomeNotes.ts";

const DAILY_NOTE_MAX = 200_000;
const DAILY_LINE_MAX = 2_000;

/** A calendar day as the owner's device sees it; the server's clock may be in another zone. */
const DailyNoteDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

export const MajordomeDailyNoteInput = Schema.Struct({ projectId: ProjectId, date: DailyNoteDate });
export type MajordomeDailyNoteInput = typeof MajordomeDailyNoteInput.Type;

export const MajordomeDailyNoteResult = Schema.Struct({
  /** Relative to the vault, with `/` separators. */
  path: Schema.String,
  /** Null when that day has no note yet. */
  content: Schema.NullOr(Schema.String),
});
export type MajordomeDailyNoteResult = typeof MajordomeDailyNoteResult.Type;

export const MajordomeSaveDailyNoteInput = Schema.Struct({
  projectId: ProjectId,
  date: DailyNoteDate,
  content: Schema.String.check(Schema.isMaxLength(DAILY_NOTE_MAX)),
  /** The note as the editor loaded it; a note that no longer reads this way is left alone. */
  base: Schema.NullOr(Schema.String),
});
export type MajordomeSaveDailyNoteInput = typeof MajordomeSaveDailyNoteInput.Type;

export const MajordomeAddToDailyNoteInput = Schema.Struct({
  projectId: ProjectId,
  date: DailyNoteDate,
  /** The owner's local time, written before the line. */
  time: Schema.String.check(Schema.isPattern(/^\d{2}:\d{2}$/)),
  text: Schema.String.check(Schema.isMaxLength(DAILY_LINE_MAX)),
});
export type MajordomeAddToDailyNoteInput = typeof MajordomeAddToDailyNoteInput.Type;

/** `message` is written for the owner. */
export class MajordomeDailyNoteError extends Schema.TaggedError<MajordomeDailyNoteError>()(
  "MajordomeDailyNoteError",
  {
    message: Schema.String,
    reason: Schema.optional(MajordomeNoteSaveRefusal),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
