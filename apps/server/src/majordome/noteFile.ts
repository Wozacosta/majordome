/** Reading and replacing one note's file, shared by every way the owner edits a note in place. */

import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

/** What a save fails with when the note no longer reads as the editor loaded it. */
export const NOTE_CHANGED_WHILE_WRITING = {
  message: "This note was changed somewhere else while you were writing.",
  reason: "changed",
} as const;

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

/**
 * Where `relative` is in the vault, or none when it, or a link on the way to it, leads out. A
 * file that is not there yet is judged by the nearest folder that is.
 */
export const resolveInVault = Effect.fn("majordome.resolveInVault")(function* (
  vaultRoot: string,
  relative: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(vaultRoot, relative);
  const inside = Effect.gen(function* () {
    const realRoot = yield* fileSystem.realPath(vaultRoot);
    let existing = absolute;
    while (!(yield* fileSystem.exists(existing))) {
      // A link to nothing would still be written through.
      if (Option.isSome(yield* fileSystem.readLink(existing).pipe(Effect.option))) return false;
      const parent = path.dirname(existing);
      if (parent === existing) return false;
      existing = parent;
    }
    const real = yield* fileSystem.realPath(existing);
    return existing === absolute
      ? real.startsWith(`${realRoot}${path.sep}`)
      : real === realRoot || real.startsWith(`${realRoot}${path.sep}`);
  });
  return (yield* inside.pipe(Effect.orElseSucceed(() => false)))
    ? Option.some(absolute)
    : Option.none<string>();
});
