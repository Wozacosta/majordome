/**
 * The owner's own edits to a note that is already in the vault, from the Notes page. Writes hold
 * the vault's lock and are saved with their other edits.
 */

import { MajordomeNoteError, type MajordomeSaveNoteInput } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { NOTE_CHANGED_WHILE_WRITING, replaceNoteIfUnchanged } from "./noteFile.ts";
import { isSkippedEntry } from "./notesIndex.ts";
import { readVaultLayout } from "./vaultConfig.ts";
import * as VaultLock from "./VaultLock.ts";

const isNoteError = Schema.is(MajordomeNoteError);

const MARKDOWN_NOTE = /\.(?:md|markdown)$/i;

export class MajordomeNotes extends Context.Service<
  MajordomeNotes,
  {
    /** Replaces a Markdown note that exists, only while it still reads as the editor loaded it. */
    readonly save: (input: MajordomeSaveNoteInput) => Effect.Effect<void, MajordomeNoteError>;
  }
>()("t3/majordome/MajordomeNotes") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const vaultLock = yield* VaultLock.VaultLock;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  /** The note's file, or a failure for a path that leaves the vault or is not one of its notes. */
  const resolveNote = Effect.fn("MajordomeNotes.resolveNote")(function* (
    vaultRoot: string,
    notePath: string,
  ) {
    const outside = new MajordomeNoteError({ message: "That note is not in your notes folder." });
    if (path.isAbsolute(notePath)) return yield* outside;
    const absolute = path.resolve(vaultRoot, notePath);
    const segments = path.relative(vaultRoot, absolute).split(path.sep);
    if (segments.some((segment) => segment === "" || segment === ".." || isSkippedEntry(segment))) {
      return yield* outside;
    }
    if (!MARKDOWN_NOTE.test(segments.at(-1) ?? "")) {
      return yield* new MajordomeNoteError({ message: "Only Markdown notes can be edited here." });
    }
    const gone = new MajordomeNoteError({
      message: "That note is no longer in your notes folder.",
    });
    // A link inside the vault can still point out of it.
    const realRoot = yield* fileSystem.realPath(vaultRoot);
    const realFile = yield* fileSystem.realPath(absolute).pipe(Effect.mapError(() => gone));
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) return yield* outside;
    const info = yield* fileSystem.stat(realFile).pipe(Effect.mapError(() => gone));
    if (info.type !== "File") return yield* outside;
    return realFile;
  });

  const save: MajordomeNotes["Service"]["save"] = Effect.fn("MajordomeNotes.save")(
    function* (input) {
      const project = Option.getOrUndefined(yield* projects.get(input.projectId));
      const layout =
        project === undefined ? Option.none() : yield* readVaultLayout(project.workspaceRoot);
      if (project === undefined || Option.isNone(layout)) {
        return yield* new MajordomeNoteError({ message: "That notes folder was not found." });
      }
      yield* vaultLock.withLock(
        project.workspaceRoot,
        Effect.gen(function* () {
          const file = yield* resolveNote(project.workspaceRoot, input.path);
          if (!(yield* replaceNoteIfUnchanged({ ...input, file }))) {
            return yield* new MajordomeNoteError({ message: NOTE_CHANGED_WHILE_WRITING });
          }
        }),
      );
    },
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
    Effect.mapError((cause) =>
      isNoteError(cause)
        ? cause
        : new MajordomeNoteError({ message: "Could not save that note.", cause }),
    ),
  );

  return MajordomeNotes.of({ save });
});

export const layer = Layer.effect(MajordomeNotes, make);
