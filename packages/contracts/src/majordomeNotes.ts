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

/** `message` is written for the owner. */
export class MajordomeNoteError extends Schema.TaggedError<MajordomeNoteError>()(
  "MajordomeNoteError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
