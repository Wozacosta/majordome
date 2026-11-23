import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";

const NOTE_MAX = 1_000_000;

export const MajordomeSaveNoteInput = Schema.Struct({
  projectId: ProjectId,
  /** Relative to the vault. Only a Markdown note that is already there can be saved. */
  path: Schema.String.check(Schema.isMaxLength(4096)),
  content: Schema.String.check(Schema.isMaxLength(NOTE_MAX)),
  /** The note as the editor loaded it; a note that no longer reads this way is left alone. */
  base: Schema.String,
});
export type MajordomeSaveNoteInput = typeof MajordomeSaveNoteInput.Type;

/** Why a save was refused, when the editor offers different ways out of it. */
export const MajordomeNoteSaveRefusal = Schema.Literals(["changed"]);

/** `message` is written for the owner. */
export class MajordomeNoteError extends Schema.TaggedError<MajordomeNoteError>()(
  "MajordomeNoteError",
  {
    message: Schema.String,
    /** "changed": the note no longer reads as the editor loaded it, so nothing was written. */
    reason: Schema.optional(MajordomeNoteSaveRefusal),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
