/**
 * To-dos for a vault project: the markdown checkboxes of its notes. Nothing is stored elsewhere;
 * ticking one rewrites its line in the note, and a new one goes to `To-dos.md` in the inbox
 * folder. Writes hold the vault's lock and are saved with the owner's other edits.
 */

import {
  type MajordomeAddTodoInput,
  type MajordomeSetTodoDoneInput,
  type MajordomeTodo,
  type MajordomeTodoNote,
  MajordomeTodosError,
  type MajordomeTodosInput,
  type MajordomeTodosResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { isNoteFile, isSkippedEntry, NOTE_MAX_BYTES, readNote } from "./notesIndex.ts";
import { readVaultLayout } from "./vaultConfig.ts";
import * as VaultLock from "./VaultLock.ts";

const MAX_NOTES = 50;
const MAX_TODOS_PER_NOTE = 20;
const MAX_FOLDER_DEPTH = 32;
const READ_CONCURRENCY = 8;
const STAT_CONCURRENCY = 16;
const TODOS_FILENAME = "To-dos.md";
const NEWLINE = 0x0a;

// The list marker and opening bracket, the box, then the text.
const CHECKBOX = /^(\s*[-*+]\s+\[)([ xX])\]\s+(\S.*?)\s*$/;
const FENCE = /^\s*(?:```|~~~)/;

const isTodosError = Schema.is(MajordomeTodosError);

function parseCheckbox(line: string) {
  const match = CHECKBOX.exec(line);
  if (match === null) return null;
  return { prefix: match[1]!, done: match[2] !== " ", text: match[3]! };
}

function openTodos(text: string): ReadonlyArray<MajordomeTodo> {
  const todos: Array<MajordomeTodo> = [];
  let fenced = false;
  text.split("\n").forEach((line, index) => {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      const box = parseCheckbox(line);
      if (box !== null && !box.done) todos.push({ line: index + 1, text: box.text });
    }
  });
  return todos;
}

export class MajordomeTodos extends Context.Service<
  MajordomeTodos,
  {
    readonly list: (
      input: MajordomeTodosInput,
    ) => Effect.Effect<MajordomeTodosResult, MajordomeTodosError>;
    /** Ticks or unticks one checkbox, only while its line still reads as it was listed. */
    readonly setDone: (
      input: MajordomeSetTodoDoneInput,
    ) => Effect.Effect<void, MajordomeTodosError>;
    readonly add: (input: MajordomeAddTodoInput) => Effect.Effect<void, MajordomeTodosError>;
  }
>()("t3/majordome/MajordomeTodos") {}

const NOTE_CHANGED = "That note changed. Refresh and try again.";

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const vaultLock = yield* VaultLock.VaultLock;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const vaultOf = Effect.fn("MajordomeTodos.vaultOf")(function* (
    projectId: MajordomeTodosInput["projectId"],
  ) {
    const project = Option.getOrUndefined(yield* projects.get(projectId));
    if (project === undefined) return undefined;
    const layout = yield* readVaultLayout(project.workspaceRoot).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    return Option.isSome(layout)
      ? { root: project.workspaceRoot, layout: layout.value }
      : undefined;
  });

  const requireVault = (projectId: MajordomeTodosInput["projectId"]) =>
    vaultOf(projectId).pipe(
      Effect.filterOrFail(
        (vault) => vault !== undefined,
        () => new MajordomeTodosError({ message: "That notes folder was not found." }),
      ),
    );

  const scanNotes = Effect.fn("MajordomeTodos.scanNotes")(function* (vaultRoot: string) {
    const found: Array<{ readonly path: string; readonly mtimeMs: number }> = [];
    // Per folder, inside the scan's span.
    const visit: (folder: string, depth: number) => Effect.Effect<void> = Effect.fnUntraced(
      function* (folder, depth) {
        const names = yield* fileSystem
          .readDirectory(path.join(vaultRoot, folder))
          .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
        const folders: Array<string> = [];
        yield* Effect.forEach(
          names,
          // Per directory entry, inside the scan's span.
          Effect.fnUntraced(function* (name) {
            if (isSkippedEntry(name)) return;
            if (folder === "" && name.toLowerCase() === "archive") return;
            const relative = folder === "" ? name : `${folder}/${name}`;
            const info = yield* fileSystem.stat(path.join(vaultRoot, relative)).pipe(Effect.option);
            if (Option.isNone(info)) return;
            if (info.value.type === "Directory") {
              if (depth < MAX_FOLDER_DEPTH) folders.push(relative);
            } else if (
              info.value.type === "File" &&
              isNoteFile(name) &&
              Number(info.value.size) <= NOTE_MAX_BYTES
            ) {
              found.push({
                path: relative,
                mtimeMs: Option.getOrUndefined(info.value.mtime)?.getTime() ?? 0,
              });
            }
          }),
          { concurrency: STAT_CONCURRENCY, discard: true },
        );
        yield* Effect.forEach(folders, (next) => visit(next, depth + 1), { discard: true });
      },
    );
    yield* visit("", 0);
    return found;
  });

  const list: MajordomeTodos["Service"]["list"] = Effect.fn("MajordomeTodos.list")(
    function* (input) {
      const vault = yield* vaultOf(input.projectId);
      if (vault === undefined) return { isVault: false, notes: [], totalOpen: 0, totalNotes: 0 };
      const withTodos = (yield* Effect.forEach(
        yield* scanNotes(vault.root),
        // Per note, inside the list's span.
        Effect.fnUntraced(function* (file) {
          const text = yield* fileSystem
            .readFileString(path.join(vault.root, file.path))
            .pipe(Effect.option);
          if (Option.isNone(text)) return null;
          const todos = openTodos(text.value);
          const note = todos.length === 0 ? null : readNote(file.path, text.value);
          return note === null ? null : { ...file, title: note.title, todos };
        }),
        { concurrency: READ_CONCURRENCY },
      ))
        .filter((note) => note !== null)
        .toSorted(
          (left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path),
        );
      return {
        isVault: true,
        notes: withTodos.slice(0, MAX_NOTES).map((note): MajordomeTodoNote => ({
          path: note.path,
          title: note.title,
          modifiedAt: DateTime.formatIso(DateTime.makeUnsafe(note.mtimeMs)),
          todos: note.todos.slice(0, MAX_TODOS_PER_NOTE),
          more: Math.max(0, note.todos.length - MAX_TODOS_PER_NOTE),
        })),
        totalOpen: withTodos.reduce((sum, note) => sum + note.todos.length, 0),
        totalNotes: withTodos.length,
      };
    },
    Effect.mapError(
      (cause) => new MajordomeTodosError({ message: "Could not read your to-dos.", cause }),
    ),
  );

  /** The note's file, or a failure for a path that leaves the vault or names its plumbing. */
  const resolveNote = Effect.fn("MajordomeTodos.resolveNote")(function* (
    vaultRoot: string,
    notePath: string,
  ) {
    const outside = new MajordomeTodosError({ message: "That note is not in your notes folder." });
    if (path.isAbsolute(notePath)) return yield* outside;
    const absolute = path.resolve(vaultRoot, notePath);
    const segments = path.relative(vaultRoot, absolute).split(path.sep);
    if (
      segments.some((segment) => segment === "" || segment === ".." || isSkippedEntry(segment)) ||
      !isNoteFile(segments.at(-1) ?? "")
    ) {
      return yield* outside;
    }
    // A link inside the vault can still point out of it.
    const realRoot = yield* fileSystem.realPath(vaultRoot);
    const realFile = yield* fileSystem
      .realPath(absolute)
      .pipe(Effect.mapError(() => new MajordomeTodosError({ message: NOTE_CHANGED })));
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) return yield* outside;
    return realFile;
  });

  const setDone: MajordomeTodos["Service"]["setDone"] = Effect.fn("MajordomeTodos.setDone")(
    function* (input) {
      const vault = yield* requireVault(input.projectId);
      const stale = new MajordomeTodosError({ message: NOTE_CHANGED });
      yield* vaultLock.withLock(
        vault.root,
        Effect.gen(function* () {
          const file = yield* resolveNote(vault.root, input.path);
          const bytes = yield* fileSystem.readFile(file);
          let start = 0;
          for (let line = 1; line < input.line; line++) {
            const newline = bytes.indexOf(NEWLINE, start);
            if (newline === -1) return yield* stale;
            start = newline + 1;
          }
          const newline = bytes.indexOf(NEWLINE, start);
          // The byte order mark stays in the text so the box's offset counts it.
          const box = parseCheckbox(
            new TextDecoder("utf-8", { ignoreBOM: true }).decode(
              bytes.subarray(start, newline === -1 ? bytes.length : newline),
            ),
          );
          if (box === null || box.text !== input.text) return yield* stale;
          if (box.done === input.done) return;
          // Only the box's one byte changes, so the rest of the note is untouched.
          const next = bytes.slice();
          next[start + new TextEncoder().encode(box.prefix).length] = (
            input.done ? "x" : " "
          ).charCodeAt(0);
          yield* fileSystem.writeFile(file, next);
        }),
      );
    },
    Effect.mapError((cause) =>
      isTodosError(cause)
        ? cause
        : new MajordomeTodosError({ message: "Could not change that to-do.", cause }),
    ),
  );

  const add: MajordomeTodos["Service"]["add"] = Effect.fn("MajordomeTodos.add")(
    function* (input) {
      const text = input.text.trim();
      if (text === "") {
        return yield* new MajordomeTodosError({ message: "Write what there is to do first." });
      }
      if (/[\r\n]/.test(text)) {
        return yield* new MajordomeTodosError({ message: "Keep a to-do on one line." });
      }
      const vault = yield* requireVault(input.projectId);
      const folder = path.join(vault.root, vault.layout.inboxFolder);
      const file = path.join(folder, TODOS_FILENAME);
      yield* vaultLock.withLock(
        vault.root,
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(folder, { recursive: true });
          const existing = yield* fileSystem.readFile(file).pipe(Effect.option);
          const lead = Option.match(existing, {
            onNone: () => "# To-dos\n\n",
            onSome: (bytes) => (bytes.length === 0 || bytes.at(-1) === NEWLINE ? "" : "\n"),
          });
          yield* fileSystem.writeFileString(file, `${lead}- [ ] ${text}\n`, { flag: "a" });
        }),
      );
    },
    Effect.mapError((cause) =>
      isTodosError(cause)
        ? cause
        : new MajordomeTodosError({ message: "Could not add that to-do.", cause }),
    ),
  );

  return MajordomeTodos.of({ list, setDone, add });
});

export const layer = Layer.effect(MajordomeTodos, make);
