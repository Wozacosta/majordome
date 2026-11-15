// The AI agents obrain knows how to wire a brain into, and where each one looks.
// Paths are functions so tests can point HOME (and friends) at a sandbox.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = (...p) => path.join(os.homedir(), ...p);
const xdgConfig = () => process.env.XDG_CONFIG_HOME || home(".config");
const say = (skill) => `Use the ${skill} skill.`;

/**
 * Every agent reads <brain>/AGENTS.md and <brain>/.agents/skills, except where noted:
 * - Claude Code reads CLAUDE.md (AGENTS.md only when there's no CLAUDE.md) and only
 *   .claude/skills, so the brain gets a CLAUDE.md that imports AGENTS.md and a
 *   .claude/skills symlink.
 * - Gemini CLI reads GEMINI.md by default, so the brain gets one that imports AGENTS.md.
 * - Cursor keeps global rules in its settings, not a file: no global block.
 * - OpenCode falls back to ~/.claude/CLAUDE.md when it has no AGENTS.md of its own.
 *
 * configDir: the agent counts as set up on this machine when it exists.
 * globalFile: its user-wide instructions file, where the `## obrain` block goes.
 * args: how to start it interactively on a skill (or with no prompt).
 */
export const AGENTS = [
  {
    id: "claude",
    label: "Claude Code",
    bins: () => ["claude", home(".local", "bin", "claude")],
    configDir: () => process.env.CLAUDE_CONFIG_DIR || home(".claude"),
    globalFile: (dir) => path.join(dir, "CLAUDE.md"),
    args: (skill) => (skill ? [`/${skill}`] : []),
    install: "curl -fsSL https://claude.ai/install.sh | bash",
  },
  {
    id: "codex",
    label: "Codex",
    bins: () => ["codex"],
    configDir: () => process.env.CODEX_HOME || home(".codex"),
    // Codex reads AGENTS.override.md instead of AGENTS.md when it exists
    globalFile: (dir) =>
      fs.existsSync(path.join(dir, "AGENTS.override.md"))
        ? path.join(dir, "AGENTS.override.md")
        : path.join(dir, "AGENTS.md"),
    args: (skill) => (skill ? [`$${skill}`] : []),
    install: "npm install -g @openai/codex",
  },
  {
    id: "cursor",
    label: "Cursor CLI",
    // `agent` is a generic name: only trust it when Cursor is set up
    bins: () => ["cursor-agent", ...(fs.existsSync(home(".cursor")) ? ["agent"] : [])],
    configDir: () => home(".cursor"),
    globalFile: null,
    args: (skill) => (skill ? [say(skill)] : []),
    install: "curl https://cursor.com/install -fsS | bash",
  },
  {
    id: "opencode",
    label: "OpenCode",
    bins: () => ["opencode", home(".opencode", "bin", "opencode")],
    configDir: () => path.join(xdgConfig(), "opencode"),
    globalFile: (dir) => path.join(dir, "AGENTS.md"),
    args: (skill) => (skill ? ["--prompt", say(skill)] : []),
    install: "curl -fsSL https://opencode.ai/install | bash",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    bins: () => ["gemini"],
    configDir: () => home(".gemini"),
    globalFile: (dir) => path.join(dir, "GEMINI.md"),
    args: (skill) => (skill ? ["-i", say(skill)] : []),
    install: "npm install -g @google/gemini-cli",
  },
];

export const agent = (id) => AGENTS.find((a) => a.id === id);

/** Agents whose config folder exists, i.e. that have been run on this machine */
export const configuredAgents = () => AGENTS.filter((a) => fs.existsSync(a.configDir()));
