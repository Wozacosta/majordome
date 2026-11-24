/**
 * A vault's skills: instructions the assistant follows by name, one folder each with a `SKILL.md`.
 * A skill steers every later run, including the ones nobody watches, so one the assistant writes
 * waits in `PROPOSED_SKILLS_DIR` until the owner keeps it. `holdBackRunChanges` enforces that when
 * a run ends, and holds back the vault's instructions, config and agent settings the same way.
 */

import type { MajordomeProposedSkill, MajordomeSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { PROPOSED_SKILLS_DIR, SKILLS_DIR } from "./skillsGuide.ts";
import { identityEnv, ownerIdentity } from "./vaultAutosave.ts";
import { VAULT_CONFIG_DIRNAME } from "./vaultConfig.ts";

/** Claude Code's own folder: a link to `SKILLS_DIR` in most vaults, a real folder in older ones. */
const CLAUDE_SKILLS_DIR = ".claude/skills";
const SKILL_FILE = "SKILL.md";
const SKILL_TEXT_MAX = 20_000;

/** Flat names with `.txt` added, so nothing in it reads as an instruction file or a settings folder. */
export const HELD_BACK_DIR = ".agents/held-back";
const ROOT_FILES_HELD_BACK: ReadonlySet<string> = new Set([
  "claude.md",
  "agents.md",
  `${VAULT_CONFIG_DIRNAME}/config.json`,
]);

/**
 * True for a file that steers later runs: the vault's own instructions and config, anything in an
 * agent's settings folder, and skills. Case is ignored, as the owner's disk may ignore it too.
 */
export function steersLaterRuns(relativePath: string): boolean {
  const segments = relativePath.toLowerCase().split("/");
  return (
    ROOT_FILES_HELD_BACK.has(segments.join("/")) ||
    segments.some(
      (segment, index) =>
        segment === ".claude" || (segment === ".agents" && segments[index + 1] === "skills"),
    )
  );
}

const HEADER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** A `SKILL.md` split into its header's description and the instructions under it. */
export function parseSkill(text: string): { readonly description: string; readonly text: string } {
  const header = HEADER.exec(text);
  if (header === null) return { description: "", text: text.trim() };
  const lines = header[1]!.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("description:"));
  let description = "";
  if (start !== -1) {
    const parts = [lines[start]!.slice("description:".length)];
    // A long description continues on indented lines.
    for (const line of lines.slice(start + 1)) {
      if (!/^\s+\S/.test(line)) break;
      parts.push(line);
    }
    description = parts
      .map((part) => part.trim())
      .filter((part) => part !== "" && part !== ">" && part !== "|" && part !== ">-")
      .join(" ")
      .replace(/^(["'])(.*)\1$/, "$2");
  }
  return { description, text: text.slice(header[0].length).trim() };
}

const readSkillsIn = Effect.fn("majordome.readSkillsIn")(function* (folder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fileSystem
    .readDirectory(folder)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  const skills: Array<MajordomeSkill> = [];
  for (const name of names.toSorted((left, right) => left.localeCompare(right))) {
    const file = yield* fileSystem
      .readFileString(path.join(folder, name, SKILL_FILE))
      .pipe(Effect.option);
    if (file._tag === "None") continue;
    const skill = parseSkill(file.value);
    skills.push({
      name,
      description: skill.description,
      text:
        skill.text.length <= SKILL_TEXT_MAX
          ? skill.text
          : `${skill.text.slice(0, SKILL_TEXT_MAX)}…`,
    });
  }
  return skills;
});

export const readVaultSkills = Effect.fn("majordome.readVaultSkills")(function* (
  vaultRoot: string,
) {
  const path = yield* Path.Path;
  const skills = yield* readSkillsIn(path.join(vaultRoot, SKILLS_DIR));
  const inUse = new Set(skills.map((skill) => skill.name));
  const proposed = (yield* readSkillsIn(path.join(vaultRoot, PROPOSED_SKILLS_DIR))).map(
    (skill): MajordomeProposedSkill => ({ ...skill, replaces: inUse.has(skill.name) }),
  );
  return { skills, proposed };
});

/**
 * Saves one decision of the owner's as its own entry in the vault's history, at once: left
 * unsaved, the end of a run would take it for the run's and hold it back. Callers hold the lock.
 */
export const commitOwnerDecision = Effect.fn("majordome.commitSkillDecision")(function* (input: {
  readonly vaultRoot: string;
  readonly subject: string;
  readonly paths: ReadonlyArray<string>;
}) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const env = identityEnv(yield* ownerIdentity(input.vaultRoot));
  const run = (args: ReadonlyArray<string>, allowNonZeroExit = false) =>
    git.execute({
      operation: "majordome.skillDecision",
      cwd: input.vaultRoot,
      args,
      env,
      allowNonZeroExit,
    });
  // Git refuses a path it has never seen and that is gone, such as a draft kept before it was saved.
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tracked = (yield* run(["ls-files", "-z", "--", ...input.paths])).stdout;
  const paths: Array<string> = [];
  for (const candidate of input.paths) {
    const known =
      tracked.split("\u0000").some((file) => file.startsWith(`${candidate}/`)) ||
      (yield* fileSystem.exists(path.join(input.vaultRoot, candidate)));
    if (known) paths.push(candidate);
  }
  if (paths.length === 0) return;
  yield* run(["add", "--all", "--", ...paths]);
  const staged = yield* run(["diff", "--cached", "--quiet", "--", ...paths], true);
  if (staged.exitCode === 0) return;
  yield* run([
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--no-verify",
    "--message",
    input.subject,
    "--",
    ...paths,
  ]);
});

/** False when no skill of that name waits. Callers hold the vault's lock. */
export const keepProposedSkill = Effect.fn("majordome.keepProposedSkill")(function* (input: {
  readonly vaultRoot: string;
  readonly name: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const from = path.join(input.vaultRoot, PROPOSED_SKILLS_DIR, input.name);
  const to = path.join(input.vaultRoot, SKILLS_DIR, input.name);
  if (!(yield* fileSystem.exists(path.join(from, SKILL_FILE)))) return false;
  yield* fileSystem.remove(to, { recursive: true, force: true });
  yield* fileSystem.makeDirectory(path.dirname(to), { recursive: true });
  yield* fileSystem.rename(from, to);
  yield* commitOwnerDecision({
    vaultRoot: input.vaultRoot,
    subject: `Kept a skill: ${input.name}`,
    paths: [`${PROPOSED_SKILLS_DIR}/${input.name}`, `${SKILLS_DIR}/${input.name}`],
  });
  return true;
});

/**
 * Deletes a skill that waits, or stops using one: it goes back to waiting, where keeping it brings
 * it back, unless a newer version already waits there. False when there was nothing to remove.
 * Callers hold the vault's lock.
 */
export const removeSkill = Effect.fn("majordome.removeSkill")(function* (input: {
  readonly vaultRoot: string;
  readonly name: string;
  readonly proposed: boolean;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const waiting = `${PROPOSED_SKILLS_DIR}/${input.name}`;
  const folder = input.proposed ? waiting : `${SKILLS_DIR}/${input.name}`;
  const target = path.join(input.vaultRoot, folder);
  if (!(yield* fileSystem.exists(target))) return false;
  const setAside =
    !input.proposed && !(yield* fileSystem.exists(path.join(input.vaultRoot, waiting)));
  if (setAside) {
    yield* fileSystem.makeDirectory(path.join(input.vaultRoot, PROPOSED_SKILLS_DIR), {
      recursive: true,
    });
    yield* fileSystem.rename(target, path.join(input.vaultRoot, waiting));
  } else {
    yield* fileSystem.remove(target, { recursive: true });
  }
  yield* commitOwnerDecision({
    vaultRoot: input.vaultRoot,
    subject: `${input.proposed ? "Deleted a skill" : "Stopped using a skill"}: ${input.name}`,
    paths: [folder, waiting],
  });
  return true;
});

/** Paths from `git status --porcelain -z`, a rename counting as both of its paths. */
function changedPaths(stdout: string): ReadonlyArray<string> {
  const paths: Array<string> = [];
  const tokens = stdout.split("\u0000");
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    if (token.length < 4) continue;
    paths.push(token.slice(3));
    if (token[0] === "R" || token[0] === "C") paths.push(tokens[++index] ?? "");
  }
  return paths;
}

/**
 * Called before a run's changes are committed. Every skill the run added or changed in place is
 * moved to the proposed folder, and every other file that steers later runs is copied to
 * `HELD_BACK_DIR`; then each is put back as it was. One the run deleted simply comes back.
 */
export const holdBackRunChanges = Effect.fn("majordome.holdBackSkillChanges")(function* (
  cwd: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  // A run names these files, so none is read as a pattern.
  const run = (args: ReadonlyArray<string>) =>
    git.execute({
      operation: "majordome.holdBackSkillChanges",
      cwd,
      args: ["--literal-pathspecs", ...args],
      allowNonZeroExit: true,
    });
  const putBack = Effect.fn("majordome.holdBackRunChanges.putBack")(function* (relative: string) {
    yield* fileSystem.remove(path.join(cwd, relative), { recursive: true, force: true });
    const before = yield* run(["ls-tree", "-r", "--name-only", "HEAD", "--", relative]);
    if (before.stdout.trim() !== "") yield* run(["checkout", "--quiet", "HEAD", "--", relative]);
  });

  const status = yield* run(["status", "--porcelain", "--untracked-files=all", "-z"]);
  const touchedSkills = new Map<string, string>();
  const touchedFiles = new Set<string>();
  for (const listed of changedPaths(status.stdout)) {
    const changed = listed.replace(/\/+$/, "");
    if (!steersLaterRuns(changed)) continue;
    const dir = [SKILLS_DIR, CLAUDE_SKILLS_DIR].find((skills) => changed.startsWith(`${skills}/`));
    if (dir === undefined) {
      touchedFiles.add(changed);
      continue;
    }
    const name = changed.slice(dir.length + 1).split("/")[0] ?? "";
    if (name !== "") touchedSkills.set(`${dir}/${name}`, name);
  }

  const skills: Array<string> = [];
  for (const [relative, name] of touchedSkills) {
    const written = path.join(cwd, relative);
    if (yield* fileSystem.exists(path.join(written, SKILL_FILE))) {
      const proposed = path.join(cwd, PROPOSED_SKILLS_DIR, name);
      yield* fileSystem.remove(proposed, { recursive: true, force: true });
      yield* fileSystem.makeDirectory(path.dirname(proposed), { recursive: true });
      yield* fileSystem.copy(written, proposed);
      skills.push(name);
    }
    yield* putBack(relative);
  }

  const files: Array<string> = [];
  for (const relative of touchedFiles) {
    const written = path.join(cwd, relative);
    const isLink = Option.isSome(yield* fileSystem.readLink(written).pipe(Effect.option));
    const isFile =
      !isLink &&
      (yield* fileSystem.stat(written).pipe(
        Effect.map((info) => info.type === "File"),
        Effect.orElseSucceed(() => false),
      ));
    if (isFile) {
      const waiting = path.join(cwd, HELD_BACK_DIR, `${relative.replaceAll("/", "__")}.txt`);
      yield* fileSystem.makeDirectory(path.dirname(waiting), { recursive: true });
      yield* fileSystem.copyFile(written, waiting);
    }
    yield* putBack(relative);
    files.push(relative);
  }
  return { skills, files };
});
