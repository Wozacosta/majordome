import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A sandboxed HOME and a PATH holding only fake agent CLIs
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "obrain-agents-"));
const bin = path.join(sandbox, "bin");
process.env.HOME = path.join(sandbox, "home");
process.env.XDG_CONFIG_HOME = path.join(sandbox, "config");
process.env.PATH = bin;
delete process.env.CODEX_HOME;
delete process.env.CLAUDE_CONFIG_DIR;
const tools = await import("../lib/tools.mjs");
const { AGENTS } = await import("../lib/agents.mjs");

function fake(name, version = `${name} 1.2.3`) {
  const file = path.join(bin, name);
  fs.writeFileSync(file, `#!/bin/sh\necho "${version}"\n`);
  fs.chmodSync(file, 0o755);
}

beforeEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(process.env.HOME, { recursive: true });
});
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

describe("agent detection", () => {
  it("finds nothing on an empty PATH", () => {
    assert.deepStrictEqual(tools.detectAgents(), []);
  });

  it("finds installed agent CLIs in a stable order, with their path", () => {
    fake("opencode");
    fake("codex");
    fake("claude", "2.1.300 (Claude Code)");
    const found = tools.detectAgents();
    assert.deepStrictEqual(found.map((a) => a.id), ["claude", "codex", "opencode"]);
    assert.strictEqual(found[1].bin, path.join(bin, "codex"));
    assert.strictEqual(tools.agentVersion(found[0]), "2.1.300");
  });

  it("finds Claude Code in ~/.local/bin even off PATH", () => {
    fs.mkdirSync(path.join(process.env.HOME, ".local", "bin"), { recursive: true });
    const file = path.join(process.env.HOME, ".local", "bin", "claude");
    fs.writeFileSync(file, "#!/bin/sh\n");
    fs.chmodSync(file, 0o755);
    assert.deepStrictEqual(tools.detectAgents().map((a) => a.id), ["claude"]);
  });

  it("ignores files that aren't executable", () => {
    fs.writeFileSync(path.join(bin, "codex"), "not a program");
    assert.deepStrictEqual(tools.detectAgents(), []);
  });

  it("only trusts the generic `agent` name when Cursor is set up", () => {
    fake("agent");
    assert.deepStrictEqual(tools.detectAgents(), []);
    fs.mkdirSync(path.join(process.env.HOME, ".cursor"));
    assert.deepStrictEqual(tools.detectAgents().map((a) => a.id), ["cursor"]);
  });
});

describe("pickAgent", () => {
  const claude = { id: "claude" };
  const codex = { id: "codex" };

  it("uses the remembered agent while it's installed", () => {
    assert.strictEqual(tools.pickAgent([claude, codex], "codex"), codex);
  });

  it("falls back to the only installed agent", () => {
    assert.strictEqual(tools.pickAgent([codex], "claude"), codex);
  });

  it("asks (null) when several are installed and none is remembered", () => {
    assert.strictEqual(tools.pickAgent([claude, codex], undefined), null);
    assert.strictEqual(tools.pickAgent([], "claude"), null);
  });
});

describe("launch arguments", () => {
  const args = (id, skill) => AGENTS.find((a) => a.id === id).args(skill);

  it("opens each agent on a skill the way it expects", () => {
    assert.deepStrictEqual(args("claude", "morning"), ["/morning"]);
    assert.deepStrictEqual(args("codex", "morning"), ["$morning"]);
    assert.deepStrictEqual(args("opencode", "morning"), ["--prompt", "Use the morning skill."]);
    assert.deepStrictEqual(args("gemini", "morning"), ["-i", "Use the morning skill."]);
    assert.deepStrictEqual(args("cursor", "morning"), ["Use the morning skill."]);
    for (const a of AGENTS) assert.deepStrictEqual(a.args(), [], a.id);
  });
});
