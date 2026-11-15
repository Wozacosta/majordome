// Find and install what obrain needs: Obsidian and at least one AI agent CLI.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENTS } from "./agents.mjs";

const mac = process.platform === "darwin";

const has = (cmd) => which(cmd) !== null;
const ok = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;

export const supported = () => mac || process.platform === "linux";

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Absolute path of a command (searching PATH for bare names), or null */
export function which(cmd) {
  if (cmd.includes("/")) return isExecutable(cmd) ? cmd : null;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (dir && isExecutable(path.join(dir, cmd))) return path.join(dir, cmd);
  }
  return null;
}

/** The supported agent CLIs on this machine, in AGENTS order, each with its `bin` */
export function detectAgents() {
  return AGENTS.flatMap((a) => {
    const bin = a.bins().map(which).find(Boolean);
    return bin ? [{ ...a, bin }] : [];
  });
}

/**
 * Which agent to open: the remembered one if it's still installed, else the
 * only one installed. null when there's a choice to make (or nothing installed).
 */
export function pickAgent(installed, remembered) {
  return installed.find((a) => a.id === remembered) ?? (installed.length === 1 ? installed[0] : null);
}

export function agentVersion(a) {
  const r = spawnSync(a.bin, ["--version"], { encoding: "utf8", timeout: 5000 });
  if (r.status !== 0) return null;
  return (
    r.stdout
      .trim()
      .split("\n")[0]
      .replace(/\s*\(Claude Code\)$/, "")
      .replace(new RegExp(`^${a.id}(-cli)?\\s+`, "i"), "") || null
  );
}

export function hasObsidian() {
  if (mac) {
    return ["/Applications", path.join(os.homedir(), "Applications")].some((d) =>
      fs.existsSync(path.join(d, "Obsidian.app")),
    );
  }
  return (
    has("obsidian") ||
    (has("flatpak") && ok("flatpak", ["info", "md.obsidian.Obsidian"])) ||
    (has("snap") && ok("snap", ["list", "obsidian"]))
  );
}

/** How we'd install Obsidian here, or null if the user has to do it by hand */
export function obsidianInstaller() {
  if (mac && has("brew")) return { label: "Homebrew", cmd: "brew install --cask obsidian" };
  if (!mac && has("flatpak")) return { label: "Flatpak", cmd: "flatpak install -y flathub md.obsidian.Obsidian" };
  return null;
}

export const OBSIDIAN_DOWNLOAD = "https://obsidian.md/download";

/** Run a shell command, capturing output. Resolves to { ok, output }. */
export function run(cmd) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => resolve({ ok: code === 0, output }));
    child.on("error", (err) => resolve({ ok: false, output: err.message }));
  });
}

export function openInObsidian(dir) {
  const r = mac
    ? spawnSync("open", ["-a", "Obsidian", dir], { stdio: "ignore" })
    : spawnSync("xdg-open", [`obsidian://open?path=${encodeURIComponent(dir)}`], { stdio: "ignore" });
  return r.status === 0;
}

/** Hand the terminal to an agent inside the brain, optionally on a skill. Resolves with its exit code. */
export function launchAgent(a, dir, skill) {
  return new Promise((resolve) => {
    const child = spawn(a.bin, a.args(skill), { cwd: dir, stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(127));
  });
}
