/**
 * A vault's daily notes: one Markdown file per day in its daily folder. The owner reads, edits and
 * adds lines to them from Today; writes hold the vault's lock and are saved with their other edits.
 */

import {
  type MajordomeAddToDailyNoteInput,
  MajordomeDailyNoteError,
  type MajordomeDailyNoteInput,
  type MajordomeDailyNoteResult,
  type MajordomeSaveDailyNoteInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { readVaultLayout } from "./vaultConfig.ts";
import * as VaultLock from "./VaultLock.ts";

const isDailyNoteError = Schema.is(MajordomeDailyNoteError);

export class MajordomeDailyNotes extends Context.Service<
  MajordomeDailyNotes,
  {
    readonly get: (
      input: MajordomeDailyNoteInput,
    ) => Effect.Effect<MajordomeDailyNoteResult, MajordomeDailyNoteError>;
    /** Replaces the day's note, only while it still reads as the editor loaded it. */
    readonly save: (
      input: MajordomeSaveDailyNoteInput,
    ) => Effect.Effect<void, MajordomeDailyNoteError>;
    /** Adds one timed line at the end of the day's note, creating the note when missing. */
    readonly add: (
      input: MajordomeAddToDailyNoteInput,
    ) => Effect.Effect<void, MajordomeDailyNoteError>;
  }
>()("t3/majordome/MajordomeDailyNotes") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const vaultLock = yield* VaultLock.VaultLock;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const locate = Effect.fn("MajordomeDailyNotes.locate")(function* (
    input: MajordomeDailyNoteInput,
  ) {
    const project = Option.getOrUndefined(yield* projects.get(input.projectId));
    const layout =
      project === undefined
        ? Option.none()
        : yield* readVaultLayout(project.workspaceRoot).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
          );
    if (project === undefined || Option.isNone(layout)) {
      return yield* new MajordomeDailyNoteError({ message: "That notes folder was not found." });
    }
    const relative = `${layout.value.dailyFolder}/${input.date}.md`;
    return {
      root: project.workspaceRoot,
      relative,
      file: path.join(project.workspaceRoot, relative),
    };
  });

  const read = (file: string) =>
    fileSystem.readFileString(file).pipe(
      Effect.map((content): string | null => content),
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
    );

  const mapError = (message: string) =>
    Effect.mapError((cause: unknown) =>
      isDailyNoteError(cause) ? cause : new MajordomeDailyNoteError({ message, cause }),
    );

  const get: MajordomeDailyNotes["Service"]["get"] = Effect.fn("MajordomeDailyNotes.get")(
    function* (input) {
      const note = yield* locate(input);
      return { path: note.relative, content: yield* read(note.file) };
    },
    mapError("Could not read that day's note."),
  );

  const save: MajordomeDailyNotes["Service"]["save"] = Effect.fn("MajordomeDailyNotes.save")(
    function* (input) {
      const note = yield* locate(input);
      yield* vaultLock.withLock(
        note.root,
        Effect.gen(function* () {
          if ((yield* read(note.file)) !== input.base) {
            return yield* new MajordomeDailyNoteError({
              message: "This note changed while you were writing. Copy your text, then reload.",
            });
          }
          yield* fileSystem.makeDirectory(path.dirname(note.file), { recursive: true });
          yield* fileSystem.writeFileString(note.file, input.content);
        }),
      );
    },
    mapError("Could not save that day's note."),
  );

  const add: MajordomeDailyNotes["Service"]["add"] = Effect.fn("MajordomeDailyNotes.add")(
    function* (input) {
      const text = input.text.trim().replace(/\s*[\r\n]+\s*/g, " ");
      if (text === "") {
        return yield* new MajordomeDailyNoteError({ message: "Write something first." });
      }
      const note = yield* locate(input);
      yield* vaultLock.withLock(
        note.root,
        Effect.gen(function* () {
          const existing = (yield* read(note.file)) ?? "";
          const lead = existing === "" || existing.endsWith("\n") ? "" : "\n";
          yield* fileSystem.makeDirectory(path.dirname(note.file), { recursive: true });
          yield* fileSystem.writeFileString(note.file, `${lead}- ${input.time} ${text}\n`, {
            flag: "a",
          });
        }),
      );
    },
    mapError("Could not add that to the day's note."),
  );

  return MajordomeDailyNotes.of({ get, save, add });
});

export const layer = Layer.effect(MajordomeDailyNotes, make);
