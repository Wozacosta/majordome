// Brain operations with no prompts: scaffold, sync skills, status, uninstall.
// Everything here is safe to call from tests with a temporary HOME.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, agent, configuredAgents } from "./agents.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEMPLATES = path.join(ROOT, "templates");
export const FOLDERS = ["drop", "daily", "weekly", "projects", "refs", "done"];

/** Where the skills live in a brain. Every agent but Claude Code reads it directly. */
export const SKILLS_DIR = path.join(".agents", "skills");
/** Other skill folders an agent needs, each a symlink to SKILLS_DIR */
export const SKILL_LINKS = [path.join(".claude", "skills")];
/** The whole content of CLAUDE.md (and GEMINI.md): an import of the real instructions */
export const IMPORT_STUB = "@AGENTS.md\n";
/** Read by Majordome's server: `memory` and `folders.daily`. Keep the shape. */
export const MAJORDOME_CONFIG = { memory: "memory.md", folders: { daily: "daily", inbox: "drop" } };

const GLOBAL_BLOCK = "## obrain";
const BLOCK_LINE = "On launch, read ";

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const today = () => new Date().toISOString().slice(0, 10);
const lstat = (p) => fs.lstatSync(p, { throwIfNoEntry: false });
const isStub = (text) => text.trim() === IMPORT_STUB.trim();
const visible = (dir) => fs.readdirSync(dir).filter((e) => e !== ".DS_Store");

/** CLAUDE.md.bak-20261115093000, made unique if needed */
function backupName(dir, base) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  let name = `${base}.bak-${stamp}`;
  for (let i = 1; fs.existsSync(path.join(dir, name)); i++) name = `${base}.bak-${stamp}-${i}`;
  return name;
}

/** Remove a directory if nothing but .DS_Store is left in it */
function rmdirIfEmpty(dir) {
  const st = lstat(dir);
  if (!st?.isDirectory() || visible(dir).length) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function skillNames() {
  return fs
    .readdirSync(path.join(ROOT, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

const shippedSkill = (name) => read(path.join(ROOT, "skills", name, "SKILL.md"));
const template = () => read(path.join(TEMPLATES, "AGENTS.md"));

export function expand(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

export const tildify = (p) =>
  p.startsWith(os.homedir()) ? "~" + p.slice(os.homedir().length) : p;

export const defaultBrain = () => path.join(os.homedir(), "obrain");

// ── config: where the brain lives, what we installed, which agent to open ────

export function configPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "obrain", "config.json");
}

export function readConfig() {
  try {
    return JSON.parse(read(configPath()));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}

/** Merge keys into the config, e.g. { agent: "codex" } */
export function updateConfig(patch) {
  const config = { ...readConfig(), ...patch };
  writeConfig(config);
  return config;
}

export function isBrain(dir) {
  const has = (...p) => fs.existsSync(path.join(dir, ...p));
  return (has("AGENTS.md") || has("CLAUDE.md")) && (has(SKILLS_DIR) || has(".claude", "skills"));
}

/** The configured brain, else the current folder or ~/obrain if either is one */
export function findBrain() {
  const { brain } = readConfig();
  if (brain && fs.existsSync(brain)) return brain;
  for (const dir of [process.cwd(), defaultBrain()]) if (isBrain(dir)) return dir;
  return null;
}

/** What's already at a prospective brain path */
export function inspectTarget(dir) {
  if (!fs.existsSync(dir)) return { exists: false };
  if (!fs.statSync(dir).isDirectory()) return { exists: true, isFile: true };
  const entries = visible(dir);
  return {
    exists: true,
    isRepo: path.resolve(dir) === ROOT,
    isVault: fs.existsSync(path.join(dir, ".obsidian")),
    hasNotes: entries.some((e) => !e.startsWith(".")),
    hasClaudeMd: entries.includes("CLAUDE.md"),
    hasAgentsMd: entries.includes("AGENTS.md"),
  };
}

// ── skills ───────────────────────────────────────────────────────────────────

/** True when two skill folders hold the same SKILL.md and nothing else */
function sameSkill(a, b) {
  const only = (dir) => lstat(dir)?.isDirectory() && visible(dir).join() === "SKILL.md";
  return only(a) && only(b) && read(path.join(a, "SKILL.md")) === read(path.join(b, "SKILL.md"));
}

/**
 * Point every other agent's skill folder (SKILL_LINKS) at .agents/skills.
 * Older obrain versions kept the skills in a real .claude/skills: its skills move
 * into .agents/skills (edited copies and the user's own included), anything that
 * would clash is kept in .claude/skills.bak-<timestamp>, then the folder becomes
 * a symlink. A symlink pointing somewhere else is the user's and stays.
 */
export function linkSkills(brain) {
  const canonical = path.join(brain, SKILLS_DIR);
  const result = { moved: [], linked: [], backups: [], foreign: [] };
  fs.mkdirSync(canonical, { recursive: true });

  for (const rel of SKILL_LINKS) {
    const link = path.join(brain, rel);
    const st = lstat(link);
    if (st?.isSymbolicLink()) {
      if (path.resolve(path.dirname(link), fs.readlinkSync(link)) !== canonical) result.foreign.push(rel);
      continue;
    }
    if (st && !st.isDirectory()) {
      result.foreign.push(rel);
      continue;
    }
    if (st) {
      const clashes = [];
      for (const name of visible(link)) {
        const from = path.join(link, name);
        const to = path.join(canonical, name);
        if (!lstat(to)) {
          fs.renameSync(from, to);
          result.moved.push(name);
        } else if (!sameSkill(from, to)) clashes.push(name);
      }
      if (clashes.length) {
        const bak = backupName(path.dirname(link), path.basename(link));
        fs.renameSync(link, path.join(path.dirname(link), bak));
        result.backups.push(path.join(path.dirname(rel), bak));
      } else fs.rmSync(link, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.relative(path.dirname(link), canonical), link);
    result.linked.push(rel);
  }
  return result;
}

/**
 * Copy the shipped skills into <brain>/.agents/skills (after linkSkills has
 * moved any older .claude/skills over). A skill the user edited (its hash differs
 * from what we last installed, or from anything we ever shipped) is kept.
 */
export function syncSkills(brain, { config = readConfig() } = {}) {
  const layout = linkSkills(brain);
  const installed = config.skills ?? {};
  const result = { added: [], updated: [], same: [], customized: [], ...layout };

  for (const name of skillNames()) {
    const src = shippedSkill(name);
    const dest = path.join(brain, SKILLS_DIR, name, "SKILL.md");

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, src);
      result.added.push(name);
    } else {
      const current = read(dest);
      const ours = installed[name] ?? (SHIPPED_SKILLS.has(sha(current)) ? sha(current) : null);
      if (current === src) result.same.push(name);
      else if (sha(current) !== ours) {
        result.customized.push(name);
        continue; // keep their version and its recorded hash
      } else {
        fs.writeFileSync(dest, src);
        result.updated.push(name);
      }
    }
    installed[name] = sha(src);
  }

  writeConfig({ ...config, brain, skills: installed });
  return result;
}

/**
 * Older versions also copied the skills into ~/.claude/skills, where they
 * override the brain's own copies. Remove the ones that are still untouched.
 */
export function removeLegacyGlobalSkills() {
  const removed = [];
  const kept = [];
  for (const name of skillNames()) {
    const dir = path.join(os.homedir(), ".claude", "skills", name);
    const file = path.join(dir, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const text = read(file);
    if (text === shippedSkill(name) || SHIPPED_SKILLS.has(sha(text))) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(name);
    } else kept.push(name);
  }
  return { removed, kept };
}

// SHA-256 of every SKILL.md obrain shipped before this version
const SHIPPED_SKILLS = new Set([
  // 2026.4.2
  "65603166d6d75d156a8a5e536e3e7dce99a47b9f5aeb02bef78cef7061f10317",
  "ec76abd018ee34cc8c3b49c861f8c1d362076440095f76dec04770fe593862b1",
  "821b540aa372f1ef7a4f771ee1d031c07b081be5006f0df253e8bc965cc0a0ad",
  "a5cdc75aa0ca65bdda5b36ef044ad1296184a069ac8ac4e720367b790b9ce240",
  "c4a50b53bf03d29261dc972015df634af44ff25b0be4839014c8c92e47d990fa",
  "32adc9f7d4a80ff4ff08620264e27e8a5fd5f79ef1c89b269ce14e5b1253bf41",
  "c1d954bac2469807ad14ff65074d4e11d5d92791256738ab5b7c96f8339c70e7",
  // 2026.11.5 (setup.sh, before the CLI)
  "0ad16077839a9945adff067d174fa8af16e36a9b105cd436effe9373bb5246e9",
  "bd45e0c62647b7cdc8a474e06fe9ea832a6f0242be7c5a3f634a1b570a3bd37b",
  "dbe1a6504e34f6177e6df533ec93e3d05d8e0e7dba51603309b4601a973423a6",
  "fcb56d6cdafaaecc70573c028a69fb83095b2964e7a884594d55e80b27d97048",
  // 2026.11.5 (the CLI, Claude Code only)
  "4e92a8848ef3b843d6143503efad3b9191f21bb3cf84df875bd4549a08a72c68",
]);

// SHA-256 of every CLAUDE.md template obrain shipped before AGENTS.md
const CLAUDE_TEMPLATES = new Set(["daa29496a94255e73be1358c014a11a3bd9d00262a2cb276b1a9ab621bc36630"]);

// ── instructions: AGENTS.md, with CLAUDE.md (and GEMINI.md) importing it ─────

/** One-line import files the brain needs for the agents set up here */
export function importFiles() {
  const gemini = fs.existsSync(agent("gemini").configDir());
  return ["CLAUDE.md", ...(gemini ? ["GEMINI.md"] : [])];
}

/**
 * AGENTS.md holds the brain's instructions; CLAUDE.md only imports it.
 * - Neither exists: write both.
 * - CLAUDE.md is the old shipped template: replace it with the new layout.
 * - CLAUDE.md is the user's (no AGENTS.md): move it into AGENTS.md, keep the
 *   original as CLAUDE.md.bak-<timestamp>, and make CLAUDE.md the import.
 * - Both exist: leave both alone.
 */
export function setupInstructions(brain) {
  const created = [];
  const migrated = [];
  const agentsMd = path.join(brain, "AGENTS.md");
  const claudeMd = path.join(brain, "CLAUDE.md");

  if (!fs.existsSync(agentsMd)) {
    const theirs = fs.existsSync(claudeMd) ? read(claudeMd) : null;
    if (theirs !== null && !isStub(theirs) && !CLAUDE_TEMPLATES.has(sha(theirs))) {
      const backup = backupName(brain, "CLAUDE.md");
      fs.copyFileSync(claudeMd, path.join(brain, backup));
      fs.writeFileSync(agentsMd, theirs);
      fs.writeFileSync(claudeMd, IMPORT_STUB);
      migrated.push(`Moved your CLAUDE.md into AGENTS.md so every agent reads it (original kept as ${backup})`);
    } else {
      fs.writeFileSync(agentsMd, template());
      if (theirs !== null && !isStub(theirs)) {
        fs.writeFileSync(claudeMd, IMPORT_STUB);
        migrated.push("Replaced the old CLAUDE.md template with AGENTS.md");
      } else created.push("AGENTS.md");
    }
  }
  for (const file of importFiles()) {
    const dest = path.join(brain, file);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, IMPORT_STUB);
      created.push(file);
    }
  }
  return { created, migrated };
}

// ── scaffold ─────────────────────────────────────────────────────────────────

/**
 * Bring an existing brain up to the current layout without touching notes:
 * instructions, Majordome config, skills and their links, global blocks.
 */
export function upgrade(brain) {
  const { created, migrated } = setupInstructions(brain);

  const majordome = path.join(brain, ".majordome", "config.json");
  if (!fs.existsSync(majordome)) {
    fs.mkdirSync(path.dirname(majordome), { recursive: true });
    fs.writeFileSync(majordome, JSON.stringify(MAJORDOME_CONFIG, null, 2) + "\n");
    created.push(".majordome/config.json");
  }

  const skills = syncSkills(brain);
  const legacy = removeLegacyGlobalSkills();
  // The user already chose to load the brain everywhere: keep that true for
  // newly installed agents and for the brain's current path.
  const global = hasGlobalBlock() ? addGlobalBlock(brain) : [];
  return { created, migrated, skills, legacy, global };
}

/** Create or top up a brain. Never loses existing notes or instructions. */
export function scaffold(brain) {
  const created = [];
  fs.mkdirSync(brain, { recursive: true });
  for (const folder of FOLDERS) {
    const dir = path.join(brain, folder);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
      created.push(`${folder}/`);
    }
  }
  const memory = path.join(brain, "memory.md");
  if (!fs.existsSync(memory)) {
    fs.copyFileSync(path.join(TEMPLATES, "memory.md"), memory);
    created.push("memory.md");
  }
  const result = upgrade(brain);
  return { ...result, created: [...created, ...result.created] };
}

/** Copy files into drop/, never overwriting. Returns the names copied. */
export function dropFiles(brain, sources) {
  const copied = [];
  const skipped = [];
  for (const src of sources) {
    const stat = fs.existsSync(src) && fs.statSync(src);
    const files = !stat
      ? []
      : stat.isDirectory()
        ? fs.readdirSync(src).filter((f) => !f.startsWith(".")).map((f) => path.join(src, f))
        : [src];
    if (!stat) skipped.push(src);
    for (const file of files) {
      if (!fs.statSync(file).isFile()) continue;
      const dest = path.join(brain, "drop", path.basename(file));
      if (fs.existsSync(dest)) skipped.push(file);
      else {
        fs.copyFileSync(file, dest);
        copied.push(path.basename(file));
      }
    }
  }
  return { copied, skipped };
}

// ── status ───────────────────────────────────────────────────────────────────

export function status(brain) {
  const list = (dir) => {
    try {
      return fs.readdirSync(path.join(brain, dir)).filter((f) => !f.startsWith("."));
    } catch {
      return [];
    }
  };
  const file = (name) => path.join(brain, name);
  const instructions = [file("AGENTS.md"), file("CLAUDE.md")].find((f) => fs.existsSync(f));
  const todo = fs.existsSync(file("todo.md")) ? read(file("todo.md")) : "";
  const open = todo.match(/^\s*- \[ \]/gm)?.length ?? 0;
  const overdue = [...todo.matchAll(/^\s*- \[ \].*!due:(\d{4}-\d{2}-\d{2})/gm)].filter(
    (m) => m[1] < today(),
  ).length;
  const shipped = skillNames();
  const skillFile = (s) => path.join(brain, SKILLS_DIR, s, "SKILL.md");
  const missing = shipped.filter((s) => !fs.existsSync(skillFile(s)));
  const outdated = shipped.filter((s) => fs.existsSync(skillFile(s)) && read(skillFile(s)) !== shippedSkill(s));
  const canonical = path.join(brain, SKILLS_DIR);
  const links = SKILL_LINKS.map((rel) => {
    const link = path.join(brain, rel);
    const ok = !!lstat(link)?.isSymbolicLink() && path.resolve(path.dirname(link), fs.readlinkSync(link)) === canonical;
    return { path: rel, ok };
  });
  // CLAUDE.md (and GEMINI.md) should import AGENTS.md
  const imports = importFiles().map((name) => ({
    file: name,
    ok: fs.existsSync(file(name)) && isStub(read(file(name))),
  }));

  return {
    brain,
    agentsMd: fs.existsSync(file("AGENTS.md")),
    personalized: !!instructions && !read(instructions).includes("[Run /brain-setup"),
    imports,
    majordome: fs.existsSync(path.join(brain, ".majordome", "config.json")),
    todayNote: fs.existsSync(path.join(brain, "daily", `${today()}.md`)),
    drop: list("drop").length,
    projects: list("projects").length,
    dailyNotes: list("daily").length,
    todos: { open, overdue },
    skills: { shipped: shipped.length, missing, outdated, links },
    globalBlock: hasGlobalBlock(),
    globalBlocks: globalBlocks(),
    missingGlobalBlocks: missingGlobalBlocks(),
  };
}

// ── global context block in each agent's user-wide instructions ──────────────

const fileHasBlock = (file) => fs.existsSync(file) && read(file).split("\n").includes(GLOBAL_BLOCK);
const blockLine = (brain) => `${BLOCK_LINE}${path.join(brain, "AGENTS.md")} for owner context.`;

/**
 * The instructions files that should carry the block: one per agent set up on
 * this machine that has such a file. OpenCode reads ~/.claude/CLAUDE.md when it
 * has no AGENTS.md of its own, so we only create one when there's no Claude Code.
 */
export function globalTargets() {
  const claudeSetUp = fs.existsSync(agent("claude").configDir());
  return configuredAgents()
    .filter((a) => a.globalFile)
    .map((a) => ({ agent: a.id, label: a.label, file: a.globalFile(a.configDir()) }))
    .filter((t) => t.agent !== "opencode" || fs.existsSync(t.file) || !claudeSetUp);
}

/** Every agent instructions file that has the block, wherever it came from */
export function globalBlocks() {
  return AGENTS.filter((a) => a.globalFile).flatMap((a) => {
    const dir = a.configDir();
    const files =
      a.id === "codex" ? ["AGENTS.md", "AGENTS.override.md"].map((f) => path.join(dir, f)) : [a.globalFile(dir)];
    return files.filter(fileHasBlock).map((file) => ({ agent: a.id, label: a.label, file }));
  });
}

export const hasGlobalBlock = () => globalBlocks().length > 0;

/** Targets that don't have the block yet */
export const missingGlobalBlocks = () => globalTargets().filter((t) => !fileHasBlock(t.file));

/**
 * Add the block to every target that lacks it, and point existing blocks at
 * this brain. Returns the targets that changed.
 */
export function addGlobalBlock(brain) {
  const changed = [];
  for (const t of missingGlobalBlocks()) {
    fs.mkdirSync(path.dirname(t.file), { recursive: true });
    const before = fs.existsSync(t.file) ? read(t.file) : "";
    const sep = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    fs.writeFileSync(t.file, `${before}${sep}${GLOBAL_BLOCK}\n${blockLine(brain)}\n`);
    changed.push(t);
  }
  for (const t of globalBlocks()) {
    const lines = read(t.file).split("\n");
    const i = lines.indexOf(GLOBAL_BLOCK) + 1;
    if (lines[i]?.startsWith(BLOCK_LINE) && lines[i] !== blockLine(brain)) {
      lines[i] = blockLine(brain);
      fs.writeFileSync(t.file, lines.join("\n"));
      if (!changed.some((c) => c.file === t.file)) changed.push(t);
    }
  }
  return changed;
}

/** Take the block out of every file that has it. Returns the files changed. */
export function removeGlobalBlock() {
  const removed = [];
  for (const { file } of globalBlocks()) {
    const lines = read(file).split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === GLOBAL_BLOCK) {
        if (lines[i + 1]?.startsWith(BLOCK_LINE)) i++;
        continue;
      }
      out.push(lines[i]);
    }
    const text = out.join("\n");
    // A file that held nothing but our block goes, so agents fall back as before
    text.trim() === "" ? fs.rmSync(file) : fs.writeFileSync(file, text);
    removed.push(file);
  }
  return removed;
}

// ── uninstall ────────────────────────────────────────────────────────────────

/**
 * Remove what obrain added and keep the notes: the shipped skills, the skill
 * links (unless the user's own skills still need them), the global blocks, the
 * config, and AGENTS.md if it's still the template, with the CLAUDE.md/GEMINI.md
 * imports that pointed at it. todo.md, memory.md, a personalized AGENTS.md and
 * the Majordome settings are the user's and stay.
 */
export function removeScaffolding(brain) {
  const removed = [];
  const canonical = path.join(brain, SKILLS_DIR);
  const legacyDir = path.join(brain, ".claude", "skills");
  for (const [dir, rel] of [
    [canonical, SKILLS_DIR],
    [legacyDir, path.join(".claude", "skills")],
  ]) {
    if (!lstat(dir)?.isDirectory()) continue; // a symlink is handled below
    for (const name of skillNames()) {
      if (fs.existsSync(path.join(dir, name))) {
        fs.rmSync(path.join(dir, name), { recursive: true, force: true });
        removed.push(`${rel}/${name}`);
      }
    }
  }

  const userSkills = lstat(canonical)?.isDirectory() && visible(canonical).length > 0;
  for (const rel of SKILL_LINKS) {
    const link = path.join(brain, rel);
    if (!lstat(link)?.isSymbolicLink() || userSkills) continue;
    if (path.resolve(path.dirname(link), fs.readlinkSync(link)) !== canonical) continue;
    fs.unlinkSync(link);
    removed.push(`${rel} link`);
  }
  for (const dir of [canonical, path.dirname(canonical), legacyDir, path.join(brain, ".claude")]) rmdirIfEmpty(dir);

  const file = (name) => path.join(brain, name);
  if (fs.existsSync(file("AGENTS.md")) && read(file("AGENTS.md")) === template()) {
    fs.rmSync(file("AGENTS.md"));
    removed.push("AGENTS.md");
  }
  if (!fs.existsSync(file("AGENTS.md"))) {
    const backups = fs.existsSync(brain)
      ? fs.readdirSync(brain).filter((f) => f.startsWith("CLAUDE.md.bak-")).sort()
      : [];
    for (const name of ["CLAUDE.md", "GEMINI.md"]) {
      if (!fs.existsSync(file(name))) continue;
      const text = read(file(name));
      // Only an import or the untouched old template: anything else is the user's
      if (!isStub(text) && !(name === "CLAUDE.md" && CLAUDE_TEMPLATES.has(sha(text)))) continue;
      if (name === "CLAUDE.md" && backups.length) {
        fs.renameSync(file(backups.at(-1)), file(name));
        removed.push(`CLAUDE.md (restored ${backups.at(-1)})`);
      } else {
        fs.rmSync(file(name));
        removed.push(name);
      }
    }
  }

  removed.push(...removeGlobalBlock().map((f) => `${tildify(f)} obrain block`));
  removed.push(...removeLegacyGlobalSkills().removed.map((s) => `~/.claude/skills/${s}`));
  fs.rmSync(path.dirname(configPath()), { recursive: true, force: true });
  return removed;
}
