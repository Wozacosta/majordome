/** Reading and replacing one note's file, shared by every way the owner edits a note in place. */

import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

export const NOTE_CHANGED_WHILE_WRITING =
  "This note changed while you were writing. Copy your text, then reload.";

/** The note's text, or null when there is no such file. */
export const readNoteText = Effect.fn("majordome.readNoteText")(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(file).pipe(
    Effect.map((content): string | null => content),
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeed(null),
    ),
  );
});

/**
 * Replaces the note only while it still reads as `base` (null: no file yet), and says whether it
 * now holds `content`. Content already there is not written again. Call under the vault's lock.
 */
export const replaceNoteIfUnchanged = Effect.fn("majordome.replaceNoteIfUnchanged")(
  function* (input: {
    readonly file: string;
    readonly content: string;
    readonly base: string | null;
  }) {
    const current = yield* readNoteText(input.file);
    if (current === input.content) return true;
    if (current !== input.base) return false;
    yield* writeFileStringAtomically({ filePath: input.file, contents: input.content });
    return true;
  },
);
