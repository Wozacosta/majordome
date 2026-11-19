/**
 * Turns a folder into a notes folder Majordome can use: the starter folders and files, the
 * `.majordome` settings and a git history. It only adds what is missing, so a folder that already
 * holds notes keeps every one of them. The starter content comes from obrain
 * (`vp run starter-notes:sync`).
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import starter from "./starterNotes.json" with { type: "json" };
import { identityEnv, ownerIdentity } from "./vaultAutosave.ts";
import { VAULT_CONFIG_DIRNAME } from "./vaultConfig.ts";

const SETUP_SUBJECT = "Set up for Majordome";
const SKILLS_DIR = ".agents/skills";
/** Claude Code reads skills from here; the link keeps one copy for every agent. */
const CLAUDE_SKILLS_LINK = ".claude/skills";
/** Folders that hold far more than notes; saving all of one as notes would be a mistake. */
const SHARED_HOME_FOLDERS = [
  "Applications",
  "Desktop",
  "Documents",
  "Downloads",
  "Library",
  "Movies",
  "Music",
  "Pictures",
  "Public",
];

export class NotesFolderError extends Schema.TaggedError<NotesFolderError>()("NotesFolderError", {
  reason: Schema.Literal("inside-another-project"),
}) {}

/** True for a folder too broad to be notes: the home folder, one above it, or one of its shared folders. */
export function isTooBroadForNotes(input: {
  readonly folder: string;
  readonly home: string;
  readonly path: Path.Path;
}) {
  const { path } = input;
  const folder = path.resolve(input.folder);
  const home = path.resolve(input.home);
  const fromFolderToHome = path.relative(folder, home);
  if (fromFolderToHome === "" || !fromFolderToHome.startsWith("..")) return true;
  return SHARED_HOME_FOLDERS.some((name) => path.join(home, name) === folder);
}

export const setUpNotesFolder = Effect.fn("majordome.setUpNotesFolder")(function* (root: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const exists = (relative: string) =>
    fileSystem.exists(path.join(root, relative)).pipe(Effect.orElseSucceed(() => false));
  const added: Array<string> = [];
  const writeIfMissing = Effect.fn("majordome.setUpNotesFolder.write")(function* (
    relative: string,
    content: string,
  ) {
    if (yield* exists(relative)) return;
    const file = path.join(root, relative);
    yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
    yield* fileSystem.writeFileString(file, content);
    added.push(relative);
  });

  yield* fileSystem.makeDirectory(root, { recursive: true });
  const inside = yield* git.execute({
    operation: "majordome.setUpNotesFolder",
    cwd: root,
    args: ["rev-parse", "--show-prefix"],
    allowNonZeroExit: true,
  });
  // A folder inside someone's repository would have its notes committed to that repository.
  if (inside.exitCode === 0 && inside.stdout.trim() !== "") {
    return yield* new NotesFolderError({ reason: "inside-another-project" });
  }

  for (const folder of starter.folders) {
    yield* fileSystem.makeDirectory(path.join(root, folder), { recursive: true });
  }
  yield* writeIfMissing(starter.memoryFile, starter.memory);
  yield* writeIfMissing(`${VAULT_CONFIG_DIRNAME}/config.json`, starter.config);
  // Instructions the owner already wrote, under either name, stay theirs.
  if (!(yield* exists("AGENTS.md")) && !(yield* exists("CLAUDE.md"))) {
    yield* writeIfMissing("AGENTS.md", starter.instructions);
  }
  if (yield* exists("AGENTS.md")) yield* writeIfMissing("CLAUDE.md", starter.instructionsImport);
  for (const [name, skill] of Object.entries(starter.skills)) {
    yield* writeIfMissing(`${SKILLS_DIR}/${name}/SKILL.md`, skill);
  }
  if (!(yield* exists(CLAUDE_SKILLS_LINK))) {
    const link = path.join(root, CLAUDE_SKILLS_LINK);
    yield* fileSystem.makeDirectory(path.dirname(link), { recursive: true });
    const linked = yield* fileSystem.symlink(path.join("..", SKILLS_DIR), link).pipe(
      Effect.as(true),
      // Without links (some Windows setups) Claude Code still finds the skills through AGENTS.md.
      Effect.orElseSucceed(() => false),
    );
    if (linked) added.push(CLAUDE_SKILLS_LINK);
  }

  if (inside.exitCode !== 0) {
    yield* git.execute({
      operation: "majordome.setUpNotesFolder",
      cwd: root,
      args: ["init", "--quiet", "-b", "main"],
    });
  }
  if (added.length > 0) {
    const env = identityEnv(yield* ownerIdentity(root));
    const run = (args: ReadonlyArray<string>) =>
      git.execute({ operation: "majordome.setUpNotesFolder", cwd: root, args, env });
    yield* run(["add", "--", ...added]);
    // Only what was added here: notes already in the folder are saved later, after the secret scan.
    yield* run([
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--message",
      SETUP_SUBJECT,
      "--",
      ...added,
    ]);
  }
  return { added };
});
