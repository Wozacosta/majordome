import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point HOME and every agent's config dir at a sandbox before loading the module
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "obrain-test-"));
process.env.HOME = path.join(sandbox, "home");
process.env.XDG_CONFIG_HOME = path.join(sandbox, "config");
delete process.env.CODEX_HOME;
delete process.env.CLAUDE_CONFIG_DIR;
const brainOps = await import("../lib/brain.mjs");

const brain = path.join(sandbox, "home", "obrain");
const skill = (dir, name) => path.join(dir, ".agents", "skills", name, "SKILL.md");
const globalSkills = () => path.join(process.env.HOME, ".claude", "skills");
const home = (...p) => path.join(process.env.HOME, ...p);
const text = (...p) => fs.readFileSync(path.join(...p), "utf8");
const template = () => text(brainOps.TEMPLATES, "AGENTS.md");
const OLD_CLAUDE_TEMPLATE = fs.readFileSync(new URL("./fixtures/CLAUDE.md-2026.11.5", import.meta.url), "utf8");

beforeEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.mkdirSync(process.env.HOME, { recursive: true });
});
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

describe("scaffold", () => {
  it("creates folders, AGENTS.md, a CLAUDE.md import, memory.md and every skill", () => {
    const { created, skills } = brainOps.scaffold(brain);
    for (const f of brainOps.FOLDERS) assert.ok(fs.existsSync(path.join(brain, f)), f);
    for (const f of ["AGENTS.md", "CLAUDE.md", "memory.md", ".majordome/config.json"]) assert.ok(created.includes(f), f);
    assert.strictEqual(text(brain, "AGENTS.md"), template());
    assert.strictEqual(text(brain, "CLAUDE.md"), "@AGENTS.md\n");
    assert.ok(!fs.existsSync(path.join(brain, "GEMINI.md")), "no GEMINI.md without Gemini CLI");
    assert.deepStrictEqual(skills.added, brainOps.skillNames());
    for (const s of brainOps.skillNames()) assert.ok(fs.existsSync(skill(brain, s)), s);
    assert.strictEqual(brainOps.findBrain(), brain);
  });

  it("links .claude/skills to .agents/skills with a relative symlink", () => {
    const { skills } = brainOps.scaffold(brain);
    const link = path.join(brain, ".claude", "skills");
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(link), path.join("..", ".agents", "skills"));
    assert.deepStrictEqual(skills.linked, [path.join(".claude", "skills")]);
    assert.ok(fs.existsSync(path.join(link, "morning", "SKILL.md")));
  });

  it("writes .majordome/config.json in the shape Majordome reads, and keeps an existing one", () => {
    brainOps.scaffold(brain);
    const file = path.join(brain, ".majordome", "config.json");
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
      memory: "memory.md",
      folders: { daily: "daily", inbox: "drop" },
    });
    fs.writeFileSync(file, '{ "memory": "log.md" }\n');
    brainOps.scaffold(brain);
    assert.strictEqual(fs.readFileSync(file, "utf8"), '{ "memory": "log.md" }\n');
  });

  it("adds GEMINI.md importing AGENTS.md when Gemini CLI is set up", () => {
    fs.mkdirSync(home(".gemini"), { recursive: true });
    const { created } = brainOps.scaffold(brain);
    assert.ok(created.includes("GEMINI.md"));
    assert.strictEqual(text(brain, "GEMINI.md"), "@AGENTS.md\n");
  });

  it("does not install skills globally (they would override the brain's)", () => {
    brainOps.scaffold(brain);
    assert.ok(!fs.existsSync(globalSkills()));
  });

  it("leaves both alone when AGENTS.md and CLAUDE.md already exist, and keeps notes", () => {
    fs.mkdirSync(path.join(brain, "notes"), { recursive: true });
    fs.writeFileSync(path.join(brain, "AGENTS.md"), "# agents\n");
    fs.writeFileSync(path.join(brain, "CLAUDE.md"), "# mine\n");
    fs.writeFileSync(path.join(brain, "notes", "a.md"), "hello");
    const { created, migrated } = brainOps.scaffold(brain);
    assert.ok(!created.includes("CLAUDE.md") && !created.includes("AGENTS.md"));
    assert.deepStrictEqual(migrated, []);
    assert.strictEqual(text(brain, "AGENTS.md"), "# agents\n");
    assert.strictEqual(text(brain, "CLAUDE.md"), "# mine\n");
    assert.strictEqual(text(brain, "notes", "a.md"), "hello");
  });

  it("adds a CLAUDE.md import next to an existing AGENTS.md", () => {
    fs.mkdirSync(brain, { recursive: true });
    fs.writeFileSync(path.join(brain, "AGENTS.md"), "# agents\n");
    brainOps.scaffold(brain);
    assert.strictEqual(text(brain, "AGENTS.md"), "# agents\n");
    assert.strictEqual(text(brain, "CLAUDE.md"), "@AGENTS.md\n");
  });

  it("removes untouched legacy global skills but keeps the user's own", () => {
    const shipped = text(brainOps.ROOT, "skills", "morning", "SKILL.md");
    fs.mkdirSync(path.join(globalSkills(), "morning"), { recursive: true });
    fs.writeFileSync(path.join(globalSkills(), "morning", "SKILL.md"), shipped);
    fs.mkdirSync(path.join(globalSkills(), "todo"), { recursive: true });
    fs.writeFileSync(path.join(globalSkills(), "todo", "SKILL.md"), "---\nname: todo\n---\nmy own\n");

    const { legacy } = brainOps.scaffold(brain);
    assert.deepStrictEqual(legacy.removed, ["morning"]);
    assert.deepStrictEqual(legacy.kept, ["todo"]);
    assert.ok(fs.existsSync(path.join(globalSkills(), "todo", "SKILL.md")));
  });
});

describe("migrating an older brain", () => {
  it("replaces the old CLAUDE.md template with AGENTS.md and an import", () => {
    fs.mkdirSync(brain, { recursive: true });
    fs.writeFileSync(path.join(brain, "CLAUDE.md"), OLD_CLAUDE_TEMPLATE);
    const { created, migrated } = brainOps.scaffold(brain);
    assert.strictEqual(text(brain, "AGENTS.md"), template());
    assert.strictEqual(text(brain, "CLAUDE.md"), "@AGENTS.md\n");
    assert.ok(!created.includes("AGENTS.md"));
    assert.match(migrated.join("\n"), /old CLAUDE\.md template/);
    assert.ok(!fs.readdirSync(brain).some((f) => f.startsWith("CLAUDE.md.bak-")), "no backup of a template");
  });

  it("moves a personalized CLAUDE.md into AGENTS.md and keeps a backup", () => {
    const mine = "# CLAUDE.md — obrain (maker)\n\n## Owner Profile\nSam builds things.\n";
    fs.mkdirSync(brain, { recursive: true });
    fs.writeFileSync(path.join(brain, "CLAUDE.md"), mine);
    const { migrated } = brainOps.scaffold(brain);

    assert.strictEqual(text(brain, "AGENTS.md"), mine);
    assert.strictEqual(text(brain, "CLAUDE.md"), "@AGENTS.md\n");
    const backups = fs.readdirSync(brain).filter((f) => /^CLAUDE\.md\.bak-\d{14}$/.test(f));
    assert.strictEqual(backups.length, 1);
    assert.strictEqual(text(brain, backups[0]), mine);
    assert.match(migrated.join("\n"), new RegExp(`Moved your CLAUDE\\.md into AGENTS\\.md.*${backups[0]}`));
    assert.strictEqual(brainOps.status(brain).personalized, true);

    // A second run changes nothing
    assert.deepStrictEqual(brainOps.scaffold(brain).migrated, []);
    assert.strictEqual(text(brain, "AGENTS.md"), mine);
  });

  it("turns a real .claude/skills into a link, keeping edited and extra skills", () => {
    // An older obrain: skills in .claude/skills, one edited, plus the user's own
    const old = path.join(brain, ".claude", "skills");
    const hashes = {};
    for (const s of brainOps.skillNames()) {
      hashes[s] = crypto.createHash("sha256").update(text(brainOps.ROOT, "skills", s, "SKILL.md")).digest("hex");
    }
    brainOps.updateConfig({ brain, skills: hashes }); // what the old install recorded
    for (const s of brainOps.skillNames()) {
      fs.mkdirSync(path.join(old, s), { recursive: true });
      fs.writeFileSync(path.join(old, s, "SKILL.md"), text(brainOps.ROOT, "skills", s, "SKILL.md"));
    }
    fs.appendFileSync(path.join(old, "morning", "SKILL.md"), "\nAlso check the calendar.\n");
    fs.mkdirSync(path.join(old, "mine"));
    fs.writeFileSync(path.join(old, "mine", "SKILL.md"), "---\nname: mine\ndescription: x\n---\nmy skill\n");
    fs.writeFileSync(path.join(brain, ".claude", "settings.local.json"), "{}");

    const { skills } = brainOps.scaffold(brain);
    assert.ok(fs.lstatSync(old).isSymbolicLink());
    assert.ok(skills.moved.includes("mine") && skills.moved.includes("morning"));
    assert.deepStrictEqual(skills.customized, ["morning"]);
    assert.match(text(skill(brain, "morning")), /calendar/);
    assert.strictEqual(text(skill(brain, "mine")), "---\nname: mine\ndescription: x\n---\nmy skill\n");
    assert.ok(fs.existsSync(path.join(old, "mine", "SKILL.md")), "still visible to Claude Code through the link");
    assert.ok(fs.existsSync(path.join(brain, ".claude", "settings.local.json")));
    assert.deepStrictEqual(skills.backups, []);
  });

  it("keeps clashing .claude/skills copies in a backup folder", () => {
    fs.mkdirSync(path.join(brain, ".agents", "skills", "mine"), { recursive: true });
    fs.writeFileSync(path.join(brain, ".agents", "skills", "mine", "SKILL.md"), "agents version");
    fs.mkdirSync(path.join(brain, ".claude", "skills", "mine"), { recursive: true });
    fs.writeFileSync(path.join(brain, ".claude", "skills", "mine", "SKILL.md"), "claude version");

    const { skills } = brainOps.scaffold(brain);
    assert.strictEqual(skills.backups.length, 1);
    assert.strictEqual(text(brain, skills.backups[0], "mine", "SKILL.md"), "claude version");
    assert.strictEqual(text(skill(brain, "mine")), "agents version");
    assert.ok(fs.lstatSync(path.join(brain, ".claude", "skills")).isSymbolicLink());
  });

  it("leaves a .claude/skills symlink that points elsewhere alone", () => {
    const elsewhere = path.join(sandbox, "elsewhere");
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.mkdirSync(path.join(brain, ".claude"), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(brain, ".claude", "skills"));
    const { skills } = brainOps.scaffold(brain);
    assert.deepStrictEqual(skills.foreign, [path.join(".claude", "skills")]);
    assert.strictEqual(fs.readlinkSync(path.join(brain, ".claude", "skills")), elsewhere);
  });
});

describe("syncSkills", () => {
  it("keeps a skill the user edited and updates untouched ones", () => {
    brainOps.scaffold(brain);
    fs.appendFileSync(skill(brain, "morning"), "\nAlso check the calendar.\n");
    fs.writeFileSync(skill(brain, "weekly"), "stale");
    // simulate "weekly" being an older shipped version: record its hash as ours
    const config = brainOps.readConfig();
    config.skills.weekly = crypto.createHash("sha256").update("stale").digest("hex");

    const result = brainOps.syncSkills(brain, { config });
    assert.deepStrictEqual(result.customized, ["morning"]);
    assert.deepStrictEqual(result.updated, ["weekly"]);
    assert.match(text(skill(brain, "morning")), /calendar/);
  });

  it("keeps a same-named skill the user already had, even without a record", () => {
    fs.mkdirSync(path.dirname(skill(brain, "todo")), { recursive: true });
    fs.writeFileSync(skill(brain, "todo"), "---\nname: todo\ndescription: mine\n---\n");
    const result = brainOps.syncSkills(brain);
    assert.deepStrictEqual(result.customized, ["todo"]);
    assert.match(text(skill(brain, "todo")), /mine/);
  });
});

describe("dropFiles", () => {
  it("copies files and folder contents without overwriting", () => {
    brainOps.scaffold(brain);
    const src = path.join(sandbox, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "a.pdf"), "a");
    fs.writeFileSync(path.join(src, ".hidden"), "x");
    fs.writeFileSync(path.join(brain, "drop", "b.txt"), "keep");
    const single = path.join(sandbox, "b.txt");
    fs.writeFileSync(single, "new");

    const { copied, skipped } = brainOps.dropFiles(brain, [src, single, path.join(sandbox, "nope")]);
    assert.deepStrictEqual(copied, ["a.pdf"]);
    assert.strictEqual(skipped.length, 2);
    assert.strictEqual(text(brain, "drop", "b.txt"), "keep");
  });
});

describe("status", () => {
  it("counts drop/, todos and overdue items, and checks the layout", () => {
    brainOps.scaffold(brain);
    fs.writeFileSync(path.join(brain, "drop", "x.md"), "");
    fs.writeFileSync(
      path.join(brain, "todo.md"),
      "## Now\n- [ ] a !due:2000-01-01\n- [ ] b\n- [x] done\n",
    );
    const s = brainOps.status(brain);
    assert.strictEqual(s.drop, 1);
    assert.deepStrictEqual(s.todos, { open: 2, overdue: 1 });
    assert.strictEqual(s.personalized, false);
    assert.strictEqual(s.agentsMd, true);
    assert.strictEqual(s.majordome, true);
    assert.deepStrictEqual(s.skills.missing, []);
    assert.deepStrictEqual(s.skills.links, [{ path: path.join(".claude", "skills"), ok: true }]);
    assert.deepStrictEqual(s.imports, [{ file: "CLAUDE.md", ok: true }]);
  });
});

describe("global blocks", () => {
  const claudeMd = () => home(".claude", "CLAUDE.md");
  const codexMd = () => home(".codex", "AGENTS.md");
  const opencodeMd = () => path.join(process.env.XDG_CONFIG_HOME, "opencode", "AGENTS.md");
  const geminiMd = () => home(".gemini", "GEMINI.md");

  it("adds once to Claude Code and removes cleanly", () => {
    fs.mkdirSync(path.dirname(claudeMd()), { recursive: true });
    fs.writeFileSync(claudeMd(), "# Mine\nkeep me\n");
    assert.strictEqual(brainOps.addGlobalBlock(brain).length, 1);
    assert.strictEqual(brainOps.addGlobalBlock(brain).length, 0);
    assert.match(fs.readFileSync(claudeMd(), "utf8"), /## obrain\nOn launch, read .*AGENTS\.md/);
    assert.strictEqual(brainOps.removeGlobalBlock().length, 1);
    assert.strictEqual(fs.readFileSync(claudeMd(), "utf8").trim(), "# Mine\nkeep me");
  });

  it("only writes for agents whose config folder exists", () => {
    assert.deepStrictEqual(brainOps.addGlobalBlock(brain), []);
    assert.ok(!fs.existsSync(home(".claude")) && !fs.existsSync(home(".codex")));
  });

  it("covers every set-up agent, and uninstall removes them all", () => {
    for (const dir of [home(".claude"), home(".codex"), home(".gemini"), home(".cursor")]) fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.dirname(opencodeMd()), { recursive: true });
    fs.writeFileSync(codexMd(), "# codex rules\n");

    const added = brainOps.addGlobalBlock(brain).map((t) => t.agent).sort();
    // OpenCode reads ~/.claude/CLAUDE.md when it has no AGENTS.md of its own
    assert.deepStrictEqual(added, ["claude", "codex", "gemini"]);
    assert.ok(!fs.existsSync(opencodeMd()));
    for (const f of [claudeMd(), codexMd(), geminiMd()]) assert.match(fs.readFileSync(f, "utf8"), /^## obrain$/m, f);
    assert.match(fs.readFileSync(codexMd(), "utf8"), /^# codex rules\n\n## obrain\n/);

    brainOps.scaffold(brain);
    const removed = brainOps.removeScaffolding(brain);
    assert.strictEqual(removed.filter((r) => r.endsWith("obrain block")).length, 3);
    assert.ok(!brainOps.hasGlobalBlock());
    assert.strictEqual(fs.readFileSync(codexMd(), "utf8").trim(), "# codex rules");
    assert.ok(!fs.existsSync(claudeMd()), "a file holding only our block goes");
  });

  it("writes OpenCode's own AGENTS.md when it has one or there's no Claude Code", () => {
    fs.mkdirSync(path.dirname(opencodeMd()), { recursive: true });
    assert.deepStrictEqual(brainOps.addGlobalBlock(brain).map((t) => t.agent), ["opencode"]);
    assert.match(fs.readFileSync(opencodeMd(), "utf8"), /## obrain/);
  });

  it("uses Codex's AGENTS.override.md when there is one", () => {
    fs.mkdirSync(home(".codex"), { recursive: true });
    fs.writeFileSync(home(".codex", "AGENTS.override.md"), "# override\n");
    brainOps.addGlobalBlock(brain);
    assert.match(fs.readFileSync(home(".codex", "AGENTS.override.md"), "utf8"), /## obrain/);
    assert.ok(!fs.existsSync(codexMd()));
  });

  it("scaffold extends an existing block to newly set-up agents and repoints old ones", () => {
    fs.mkdirSync(path.dirname(claudeMd()), { recursive: true });
    fs.writeFileSync(claudeMd(), `## obrain\nOn launch, read ${path.join(brain, "CLAUDE.md")} for owner context.\n`);
    fs.mkdirSync(home(".codex"), { recursive: true });
    const { global } = brainOps.scaffold(brain);
    assert.deepStrictEqual(global.map((t) => t.agent).sort(), ["claude", "codex"]);
    assert.match(fs.readFileSync(claudeMd(), "utf8"), /obrain\/AGENTS\.md for owner context/);
    assert.match(fs.readFileSync(codexMd(), "utf8"), /## obrain/);
  });
});

describe("removeScaffolding", () => {
  it("removes skills, links, template AGENTS.md, imports, block and config; keeps notes, todo and memory", () => {
    fs.mkdirSync(home(".claude"), { recursive: true });
    brainOps.scaffold(brain);
    brainOps.addGlobalBlock(brain);
    fs.writeFileSync(path.join(brain, "daily", "2026-01-01.md"), "note");
    fs.writeFileSync(path.join(brain, "todo.md"), "- [ ] x");

    brainOps.removeScaffolding(brain);
    assert.ok(!fs.existsSync(path.join(brain, ".claude")));
    assert.ok(!fs.existsSync(path.join(brain, ".agents")));
    assert.ok(!fs.existsSync(path.join(brain, "AGENTS.md")));
    assert.ok(!fs.existsSync(path.join(brain, "CLAUDE.md")));
    assert.ok(fs.existsSync(path.join(brain, "daily", "2026-01-01.md")));
    assert.ok(fs.existsSync(path.join(brain, "todo.md")));
    assert.ok(fs.existsSync(path.join(brain, "memory.md")));
    assert.ok(fs.existsSync(path.join(brain, ".majordome", "config.json")), "Majordome's settings stay");
    assert.ok(!brainOps.hasGlobalBlock());
    assert.ok(!fs.existsSync(brainOps.configPath()));
  });

  it("keeps a personalized AGENTS.md and the CLAUDE.md import that loads it", () => {
    brainOps.scaffold(brain);
    fs.writeFileSync(path.join(brain, "AGENTS.md"), "# AGENTS.md — obrain (maker)\n\n## Owner Profile\nSam builds things.\n");
    brainOps.removeScaffolding(brain);
    assert.match(text(brain, "AGENTS.md"), /Sam builds things/);
    assert.strictEqual(text(brain, "CLAUDE.md"), "@AGENTS.md\n");
  });

  it("keeps the user's own skills and the link Claude Code needs to see them", () => {
    brainOps.scaffold(brain);
    fs.mkdirSync(path.join(brain, ".agents", "skills", "mine"));
    fs.writeFileSync(path.join(brain, ".agents", "skills", "mine", "SKILL.md"), "mine");
    brainOps.removeScaffolding(brain);
    assert.deepStrictEqual(fs.readdirSync(path.join(brain, ".agents", "skills")), ["mine"]);
    assert.ok(fs.existsSync(path.join(brain, ".claude", "skills", "mine", "SKILL.md")));
  });

  it("restores the CLAUDE.md backup when AGENTS.md went back to the template", () => {
    brainOps.scaffold(brain);
    fs.writeFileSync(path.join(brain, "CLAUDE.md.bak-20260101000000"), "# original\n");
    brainOps.removeScaffolding(brain);
    assert.strictEqual(text(brain, "CLAUDE.md"), "# original\n");
  });
});
