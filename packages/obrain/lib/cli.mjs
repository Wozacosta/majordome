import fs from "node:fs";
import path from "node:path";
import { styleText } from "node:util";
import * as p from "@clack/prompts";
import { AGENTS, agent } from "./agents.mjs";
import * as brainOps from "./brain.mjs";
import * as tools from "./tools.mjs";

const { expand, tildify } = brainOps;
const pkg = JSON.parse(fs.readFileSync(path.join(brainOps.ROOT, "package.json"), "utf8"));

const dim = (s) => styleText("dim", s);
const bold = (s) => styleText("bold", s);
const cyan = (s) => styleText("cyan", s);
const and = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

const COMMANDS = [
  ["/brain-setup", "one-time personalization", "set up my brain"],
  ["/morning", "start-of-day ritual", "start my day"],
  ["/weekly", "end-of-week review", "review my week"],
  ["/recap", "capture this session", "save this session"],
  ["/todo", "manage tasks", "add a todo"],
  ["/digest", "read and summarize files", "digest drop/"],
  ["/import-vault", "pull notes from another vault", "import my old vault"],
];

const HELP = `
  ${bold("obrain")} — hook Obsidian into your AI agent (${and(AGENTS.map((a) => a.label))})

  ${bold("Usage")}
    npx obrain                  set up a brain, or open the menu if you have one
    npx obrain init [path]      set up (or top up) a brain, default ~/obrain
    npx obrain start            open your agent in your brain
    npx obrain morning          open your agent and run /morning
    npx obrain agent [name]     pick which agent to open (${AGENTS.map((a) => a.id).join(", ")})
    npx obrain open             open your brain in Obsidian
    npx obrain drop <files...>  copy files or folders into drop/
    npx obrain status           health check: apps, skills, today's note, todos
    npx obrain update           update the skills and layout (keeps what you've edited)
    npx obrain uninstall        remove obrain, keep your notes

  ${bold("Options")}
    -y, --yes          accept the defaults, no questions
    --no-install       don't install Obsidian or an agent
    -v, --version      print the version

  ${bold("Inside your agent")} ${dim("(/name in Claude Code, $name in Codex, or just say it)")}
${COMMANDS.map(([c, d, say]) => `    ${c.padEnd(16)}${d.padEnd(32)}${dim(`"${say}"`)}`).join("\n")}
`;

// ── args ─────────────────────────────────────────────────────────────────────

function parse(argv) {
  const flags = { yes: false, install: true };
  const args = [];
  for (const a of argv) {
    if (a === "-y" || a === "--yes") flags.yes = true;
    else if (a === "--no-install") flags.install = false;
    else args.push(a);
  }
  if (!process.stdin.isTTY) flags.yes = true;
  return { command: args[0], args: args.slice(1), flags };
}

/** Exit cleanly when the user hits Ctrl-C or Esc on a prompt */
function answer(value) {
  if (p.isCancel(value)) {
    p.cancel("Nothing else changed.");
    process.exit(0);
  }
  return value;
}

function requireBrain() {
  const brain = brainOps.findBrain();
  if (!brain) {
    console.error(`No brain found. Run ${cyan("npx obrain init")} first.`);
    process.exit(1);
  }
  return brain;
}

// ── agents ───────────────────────────────────────────────────────────────────

const installHint = () =>
  ["claude", "codex"].map((id) => `${agent(id).label}: ${cyan(agent(id).install)}`).join("\n  ");

/**
 * The agent to open: the remembered one, the only one installed, or (with
 * several) the user's pick, which we remember. null if none is installed.
 */
async function resolveAgent(flags) {
  const installed = tools.detectAgents();
  const chosen = tools.pickAgent(installed, brainOps.readConfig().agent);
  if (chosen || !installed.length) return chosen;
  if (flags.yes) return installed[0];
  return chooseAgent(installed);
}

async function chooseAgent(installed, current) {
  const id = answer(
    await p.select({
      message: "Which agent should obrain open?",
      initialValue: current,
      options: installed.map((a) => ({ value: a.id, label: a.label, hint: a.bin })),
    }),
  );
  brainOps.updateConfig({ agent: id });
  return installed.find((a) => a.id === id);
}

const invocation = (a, skill) => (a.id === "codex" ? `$${skill}` : a.id === "claude" ? `/${skill}` : `the ${skill} skill`);

// ── init ─────────────────────────────────────────────────────────────────────

async function ensureApps(flags) {
  const s = p.spinner();
  s.start("Checking for Obsidian and an AI agent");
  const obsidian = tools.hasObsidian();
  let agents = tools.detectAgents();
  s.stop("Checked your apps");

  if (obsidian) p.log.success("Obsidian");
  else {
    const installer = tools.obsidianInstaller();
    const go =
      flags.install &&
      installer &&
      (flags.yes || answer(await p.confirm({ message: `Install Obsidian with ${installer.label}?` })));
    if (go) {
      s.start(`Installing Obsidian (${installer.cmd})`);
      const r = await tools.run(installer.cmd);
      r.ok ? s.stop("Installed Obsidian") : s.error(`Couldn't install Obsidian. Get it from ${tools.OBSIDIAN_DOWNLOAD}`);
    } else p.log.warn(`Obsidian isn't installed. Get it from ${cyan(tools.OBSIDIAN_DOWNLOAD)}`);
  }

  for (const a of agents) p.log.success(`${a.label} ${dim(tools.agentVersion(a) ?? "")}`);
  if (agents.length) return;

  // No agent at all: offer Claude Code (the default) or Codex
  let pick = null;
  if (flags.install) {
    pick = flags.yes
      ? "claude"
      : answer(
          await p.select({
            message: "obrain needs an AI agent CLI. Install one?",
            options: [
              { value: "claude", label: "Claude Code", hint: agent("claude").install },
              { value: "codex", label: "Codex", hint: agent("codex").install },
              { value: null, label: "Not now" },
            ],
          }),
        );
  }
  if (pick) {
    const a = agent(pick);
    s.start(`Installing ${a.label}`);
    const r = await tools.run(a.install);
    agents = tools.detectAgents();
    const found = agents.find((x) => x.id === pick);
    r.ok && found
      ? s.stop(`Installed ${a.label} ${tools.agentVersion(found) ?? ""}`)
      : s.error(`Couldn't install ${a.label}. Run: ${a.install}`);
    if (found) brainOps.updateConfig({ agent: pick });
  } else p.log.warn(`No AI agent found. Install one of:\n  ${installHint()}`);
}

function validateBrainPath(value) {
  const t = brainOps.inspectTarget(expand(value || "~/obrain"));
  if (t.isFile) return "That's a file, not a folder.";
  if (t.isRepo) return "That's the obrain source folder. Pick another one.";
}

async function init(args, flags) {
  p.intro(`${cyan(bold("obrain"))} ${dim(`v${pkg.version} · hook Obsidian into your AI agent`)}`);

  await ensureApps(flags);

  const suggested = tildify(brainOps.findBrain() ?? brainOps.defaultBrain());
  let raw = args[0];
  if (!raw && !flags.yes) {
    raw = answer(
      await p.text({
        message: "Where should your brain live?",
        placeholder: suggested,
        defaultValue: suggested,
        validate: validateBrainPath,
      }),
    );
  }
  const brain = expand(raw || suggested);
  const problem = validateBrainPath(brain);
  if (problem) {
    p.cancel(problem);
    process.exit(1);
  }

  const target = brainOps.inspectTarget(brain);
  if (target.hasNotes && !brainOps.isBrain(brain) && !flags.yes) {
    const kind = target.isVault ? "an Obsidian vault" : "files";
    const instructions =
      target.hasClaudeMd && !target.hasAgentsMd
        ? " Your CLAUDE.md moves into AGENTS.md, so every agent reads it (with a backup)."
        : target.hasAgentsMd
          ? " Your AGENTS.md stays as it is."
          : "";
    const go = answer(
      await p.confirm({
        message: `${tildify(brain)} already has ${kind}. Add obrain to it? Your notes stay as they are.${instructions}`,
      }),
    );
    if (!go) {
      p.cancel("Nothing changed.");
      process.exit(0);
    }
  }

  const result = brainOps.scaffold(brain);
  reportScaffold(brain, result);

  if (!flags.yes) {
    const src = answer(
      await p.text({
        message: "Any files to bring in? They'll be copied into drop/.",
        placeholder: "a folder path, or Enter to skip",
        defaultValue: "",
      }),
    );
    if (src) reportDrop(brainOps.dropFiles(brain, [expand(src)]));

    const missing = brainOps.missingGlobalBlocks();
    if (!brainOps.hasGlobalBlock() && missing.length) {
      const everywhere = answer(
        await p.confirm({
          message: `Load your brain in every ${and(missing.map((t) => t.label))} session, wherever you start it?`,
          initialValue: true,
        }),
      );
      if (everywhere) reportGlobal(brainOps.addGlobalBlock(brain));
    }
  }

  // Scripts and CI don't want a window popping up
  if (!flags.yes && tools.openInObsidian(brain)) p.log.info(`Opened ${tildify(brain)} in Obsidian`);

  p.note(
    [
      `1. In Obsidian, enable Settings → General → ${bold("Command line interface")}`,
      `2. Run ${cyan("/brain-setup")} in your agent (or say "set up my brain") to personalize everything`,
      `3. Next time, just run ${cyan("npx obrain")}`,
    ].join("\n"),
    "Next",
  );

  if (!flags.yes && tools.detectAgents().length) {
    const a = await resolveAgent(flags);
    const start = answer(await p.confirm({ message: `Start ${a.label} and run ${invocation(a, "brain-setup")} now?` }));
    if (start) {
      p.outro(`Handing over to ${a.label}…`);
      process.exit(await tools.launchAgent(a, brain, "brain-setup"));
    }
  }
  p.outro(`Your brain is at ${cyan(tildify(brain))}`);
}

function reportScaffold(brain, { created, migrated, skills, legacy, global }) {
  if (created.length) p.log.success(`Created ${created.join(", ")} in ${tildify(brain)}`);
  else p.log.info(`${tildify(brain)} already had everything`);
  for (const line of migrated) p.log.info(line);
  reportSkills(skills);
  if (legacy.removed.length) {
    p.log.info(
      `Removed old global copies of ${legacy.removed.join(", ")} from ~/.claude/skills (they overrode your brain's own)`,
    );
  }
  if (legacy.kept.length) {
    p.log.warn(
      `~/.claude/skills has your own ${legacy.kept.join(", ")}; they override the brain's versions of the same name`,
    );
  }
  reportGlobal(global);
}

function reportSkills({ added, updated, customized, same, moved = [], linked = [], backups = [], foreign = [] }) {
  if (moved.length) p.log.info(`Moved ${moved.join(", ")} into .agents/skills, where every agent finds them`);
  if (added.length) p.log.success(`Installed ${added.length} skills: ${added.join(", ")}`);
  if (updated.length) p.log.success(`Updated ${updated.join(", ")}`);
  if (customized.length) p.log.info(`Kept your edited ${customized.join(", ")}`);
  if (!added.length && !updated.length && same.length) p.log.info("Skills are up to date");
  if (linked.length) p.log.success(`Linked ${linked.join(", ")} → .agents/skills`);
  if (backups.length) p.log.warn(`Skills that clashed with .agents/skills are kept in ${backups.join(", ")}`);
  if (foreign.length) p.log.warn(`${foreign.join(", ")} isn't a link to .agents/skills; left it alone`);
}

function reportGlobal(changed) {
  if (changed?.length) p.log.success(`obrain block in ${changed.map((t) => tildify(t.file)).join(", ")}`);
}

function reportDrop({ copied, skipped }) {
  if (copied.length) p.log.success(`Copied ${copied.length} file${copied.length === 1 ? "" : "s"} into drop/`);
  if (skipped.length) p.log.warn(`Skipped ${skipped.length} (missing, or already in drop/)`);
  if (copied.length) p.log.info(`Tell your agent ${cyan('"digest and sort drop/"')}`);
}

// ── status ───────────────────────────────────────────────────────────────────

function summary(s) {
  const bits = [
    s.todayNote ? "today's note ✓" : "no note today yet",
    `${s.drop} in drop/`,
    `${s.todos.open} todo${s.todos.open === 1 ? "" : "s"}${s.todos.overdue ? `, ${styleText("yellow", `${s.todos.overdue} overdue`)}` : ""}`,
  ];
  return bits.join(dim(" · "));
}

function statusReport(brain) {
  const s = brainOps.status(brain);
  p.intro(`${cyan(bold("obrain"))} ${dim(tildify(brain))}`);

  const agents = tools.detectAgents();
  const chosen = tools.pickAgent(agents, brainOps.readConfig().agent);
  for (const a of agents) {
    p.log.success(`${a.label} ${dim(tools.agentVersion(a) ?? "")}${a === chosen ? dim(" · opens by default") : ""}`);
  }
  if (!agents.length) p.log.error(`No AI agent found. Install one of:\n  ${installHint()}`);
  tools.hasObsidian() ? p.log.success("Obsidian") : p.log.error(`Obsidian missing: ${tools.OBSIDIAN_DOWNLOAD}`);

  const { missing, outdated, shipped, links } = s.skills;
  if (missing.length) p.log.warn(`Missing skills: ${missing.join(", ")}. Run ${cyan("npx obrain update")}`);
  else if (outdated.length) p.log.info(`${outdated.join(", ")} differ from v${pkg.version} (edited, or older)`);
  else p.log.success(`${shipped} skills installed in .agents/skills`);
  const broken = [...links.filter((l) => !l.ok).map((l) => l.path), ...s.imports.filter((i) => !i.ok).map((i) => i.file)];
  if (!s.agentsMd) p.log.warn(`No AGENTS.md yet. Run ${cyan("npx obrain update")}`);
  else if (broken.length) p.log.warn(`${broken.join(", ")} don't point at AGENTS.md/.agents/skills. Run ${cyan("npx obrain update")}`);

  s.personalized
    ? p.log.success("AGENTS.md is personalized")
    : p.log.warn(`AGENTS.md is still the template. Run ${cyan("/brain-setup")} in your agent`);
  if (s.globalBlocks.length) p.log.success(`Loaded in every ${and(s.globalBlocks.map((b) => b.label))} session`);
  else p.log.info("Only loaded when an agent runs inside the brain");
  if (s.globalBlocks.length && s.missingGlobalBlocks.length) {
    p.log.info(`Not yet in ${and(s.missingGlobalBlocks.map((t) => t.label))}: run ${cyan("npx obrain update")}`);
  }

  p.log.message(`${s.dailyNotes} daily notes · ${s.projects} projects · ${summary(s)}`);
  p.outro("");
  return s;
}

// ── home menu ────────────────────────────────────────────────────────────────

async function home(brain, flags) {
  const s = brainOps.status(brain);
  const agents = tools.detectAgents();
  const a = tools.pickAgent(agents, brainOps.readConfig().agent);
  const name = a?.label ?? "your agent";
  p.intro(`${cyan(bold("obrain"))} ${dim(tildify(brain))}`);
  p.log.message(summary(s));

  const action = answer(
    await p.select({
      message: "What now?",
      options: [
        { value: "morning", label: s.todayNote ? "Pick up the day" : "Start my day", hint: `${name} · morning` },
        { value: "start", label: `Open ${name}`, hint: "in your brain" },
        { value: "open", label: "Open in Obsidian" },
        { value: "drop", label: "Add files to drop/" },
        { value: "status", label: "Check health" },
        { value: "update", label: "Update skills" },
        ...(s.personalized ? [] : [{ value: "setup", label: "Personalize", hint: `${name} · brain-setup` }]),
        ...(agents.length > 1 ? [{ value: "agent", label: "Switch agent", hint: a ? `now ${a.label}` : "" }] : []),
        { value: "uninstall", label: "Uninstall" },
        { value: "quit", label: "Quit" },
      ],
    }),
  );

  switch (action) {
    case "morning":
      return launch(brain, flags, "morning");
    case "setup":
      return launch(brain, flags, "brain-setup");
    case "start":
      return launch(brain, flags);
    case "agent": {
      const picked = await chooseAgent(agents, a?.id);
      return p.outro(`obrain opens ${picked.label} from now on`);
    }
    case "open":
      tools.openInObsidian(brain) ? p.outro("Opened in Obsidian") : p.outro("Couldn't open Obsidian");
      return;
    case "drop": {
      const src = answer(await p.text({ message: "File or folder to copy into drop/", validate: (v) => (v ? undefined : "Enter a path") }));
      reportDrop(brainOps.dropFiles(brain, [expand(src)]));
      return p.outro("");
    }
    case "status":
      p.outro("");
      return statusReport(brain);
    case "update":
      reportScaffold(brain, brainOps.upgrade(brain));
      return p.outro("");
    case "uninstall":
      return uninstall(brain, flags);
    default:
      p.outro("See you tomorrow.");
  }
}

async function launch(brain, flags, skill) {
  const a = await resolveAgent(flags);
  if (!a) {
    p.cancel(`No AI agent found. Install one of:\n  ${installHint()}`);
    process.exit(1);
  }
  p.outro(skill ? `Opening ${a.label} with ${invocation(a, skill)}…` : `Opening ${a.label}…`);
  process.exit(await tools.launchAgent(a, brain, skill));
}

/** `npx obrain agent [name]`: show or set the agent obrain opens */
async function setAgent(args, flags) {
  const installed = tools.detectAgents();
  const [id] = args;
  if (id) {
    const known = agent(id);
    if (!known) {
      console.error(`Unknown agent: ${id}. Pick one of ${AGENTS.map((a) => a.id).join(", ")}`);
      process.exit(1);
    }
    if (!installed.some((a) => a.id === id)) console.warn(`${known.label} isn't installed yet: ${known.install}`);
    brainOps.updateConfig({ agent: id });
    return console.log(`obrain opens ${known.label} from now on`);
  }
  const current = tools.pickAgent(installed, brainOps.readConfig().agent);
  if (flags.yes || installed.length < 2) {
    console.log(
      installed.length
        ? `Installed: ${installed.map((a) => a.id).join(", ")}. Opens: ${current?.id ?? installed[0].id}`
        : `No AI agent found. Install one of:\n  ${installHint()}`,
    );
    return;
  }
  const picked = await chooseAgent(installed, current?.id);
  console.log(`obrain opens ${picked.label} from now on`);
}

// ── uninstall ────────────────────────────────────────────────────────────────

async function uninstall(brain, flags) {
  if (!brain) {
    console.log("No brain found; nothing to remove.");
    return;
  }
  if (!flags.yes) {
    const go = answer(
      await p.confirm({
        message: `Remove obrain from ${tildify(brain)}? Its skills and template AGENTS.md go; your notes, todo.md and memory.md stay.`,
        initialValue: false,
      }),
    );
    if (!go) return p.cancel("Nothing changed.");
  }
  const removed = brainOps.removeScaffolding(brain);
  removed.length ? p.log.success(`Removed ${removed.join(", ")}`) : p.log.info("Nothing to remove");
  p.outro(`Notes are still in ${tildify(brain)}. Obsidian and your agents are still installed.`);
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function main(argv) {
  const { command, args, flags } = parse(argv);

  if (["help", "-h", "--help"].includes(command)) return console.log(HELP);
  if (["version", "-v", "--version"].includes(command)) return console.log(pkg.version);

  if (!tools.supported()) {
    console.error(`obrain runs on macOS and Linux; ${process.platform} isn't supported yet.`);
    process.exit(1);
  }

  switch (command) {
    case undefined: {
      const brain = brainOps.findBrain();
      if (!brain) return init(args, flags);
      if (flags.yes) return statusReport(brain);
      return home(brain, flags);
    }
    case "init":
    case "setup":
    case "install":
      return init(args, flags);
    case "start":
      return launch(requireBrain(), flags);
    case "morning":
      return launch(requireBrain(), flags, "morning");
    case "agent":
      return setAgent(args, flags);
    case "open": {
      const brain = requireBrain();
      if (!tools.openInObsidian(brain)) process.exitCode = 1;
      return;
    }
    case "drop": {
      if (!args.length) {
        console.error("Usage: npx obrain drop <files or folders...>");
        process.exit(1);
      }
      const { copied, skipped } = brainOps.dropFiles(requireBrain(), args.map(expand));
      console.log(`Copied ${copied.length} into drop/${skipped.length ? `, skipped ${skipped.length}` : ""}`);
      return;
    }
    case "status":
    case "doctor":
      return statusReport(requireBrain());
    case "update": {
      const brain = requireBrain();
      p.intro(`${cyan(bold("obrain"))} ${dim(`update · ${tildify(brain)}`)}`);
      reportScaffold(brain, brainOps.upgrade(brain));
      return p.outro("");
    }
    case "uninstall":
    case "remove":
      return uninstall(brainOps.findBrain(), flags);
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run: npx obrain help");
      process.exit(1);
  }
}
