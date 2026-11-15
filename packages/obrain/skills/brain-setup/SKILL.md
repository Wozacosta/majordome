---
name: brain-setup
description: One-time onboarding for obrain. Two-step conversation — collects context, then builds a tailored brain with a personalized AGENTS.md, folders, and skills. Use when the user says "brain setup", "set up my brain", or the brain's AGENTS.md still has the placeholder Owner Profile.
---

# brain-setup — Configure Your Brain

Run this from inside the brain folder. It works the same in any agent (Claude Code, Codex, Cursor, OpenCode…).

## Part A — Collect context

Show this prompt and wait for a response:

---

**Two things and I'll build everything:**

1. What does a typical work week look like for you?
2. What's the stuff that falls off your radar and shouldn't?

(Throw in whether you want personal life tracked too, if you want.)

---

Do NOT follow up with more questions. One response is enough.

## Part B — Derive and propose

From what they wrote, determine:
- Archetype: operator / maker / advisor / learner
- What they lose track of
- Scope: work-only / work + personal

Propose the brain layout:

```
Here's the plan:

  [folder name]/
  ├── drop/         incoming — files, ideas, links
  ├── daily/        one note per day
  ├── weekly/       end-of-week reviews
  ├── [custom]/     [purpose from their context]
  ├── [custom]/     [purpose from their context]
  ├── projects/     active work
  └── done/         completed — archived, never trashed

  Skills you'll get (by name, or just say what you want):
    /morning   — start-of-day context + priorities
    /weekly    — review the week, plan the next one
    /recap     — capture this session to the right place
    /todo      — task list (add, check off, reprioritize)
    /[custom]  — [one-liner]

  Ready? Say "go" or tell me what to adjust.
```

Wait for confirmation.

## Part C — Build

On go-ahead:

### Folder structure

Archetype-based additions:
- Operator → `people/ decisions/ ops/`
- Maker → `refs/ specs/`
- Advisor → `clients/ refs/`
- Learner → `courses/ refs/`

Work + personal scope → add `personal/`

```bash
mkdir -p drop daily weekly [archetype-folders] projects done .agents/skills/[custom]
```

### Open in Obsidian
```bash
open -a Obsidian "$(pwd)"   # macOS; on Linux: xdg-open "obsidian://open?path=$(pwd)"
```

### Write AGENTS.md

AGENTS.md is the brain's instructions file, read by every agent. Leave
`CLAUDE.md` as the single line `@AGENTS.md` (same for any other one-line
import file next to it): it only pulls AGENTS.md in.

```markdown
# AGENTS.md — obrain ([archetype])

## Owner Profile
[2-3 sentences capturing who they are and what they do.
Written from the agent's perspective about the user.]

## How This Brain Is Organized
[indented tree with one-line descriptions per folder]

## Working Style
[3-4 bullets derived from their answer:
 what they track, what slips, their rhythm, what they want from AI]

## Behavior
When a project comes up → read projects/[name]/ first
When writing → check recent daily notes for voice
When drop/ has stuff → offer to read and file it
When a person or client is mentioned → check [relevant folder]

## Skills
[one line per skill: /name — what it does ("the phrase that triggers it")]
```

### Tailor the skills

The installer already put `morning`, `weekly`, `recap`, `todo`, `digest` and `import-vault` in
`.agents/skills/`, which every agent reads (`.claude/skills` is a link to it). Don't rewrite them. Edit only the folder names they mention
(e.g. `refs/` → `courses/`) so they match the layout you just built.

**Archetype-specific skill** (write a new `SKILL.md` with `name` and `description` frontmatter):
- Operator → `.agents/skills/briefing/SKILL.md` — status across projects, people, decisions
- Maker → `.agents/skills/context/SKILL.md` — deep-load a project's full state
- Advisor → `.agents/skills/client/SKILL.md` — pull up everything about a client
- Learner → `.agents/skills/study/SKILL.md` — compile and connect notes on a topic

List it under `## Skills` in AGENTS.md.

### Write memory.md
```markdown
# Session Log

## Patterns
[Built up over time as the agent learns how you work]

## History
<!-- entries below -->
```

## Part D — Context reach

`npx obrain` already asked whether to load this brain in every agent session,
wherever it starts. The answer lives as a `## obrain` block in each agent's
global instructions file, for example:

- Claude Code → `~/.claude/CLAUDE.md`
- Codex → `~/.codex/AGENTS.md`
- OpenCode → `~/.config/opencode/AGENTS.md` (without it, OpenCode reads `~/.claude/CLAUDE.md`)

`npx obrain status` lists every agent that has the block. If it's there,
update the path in it if the brain moved. If it's nowhere, ask once:

```
Should your agents load your brain context everywhere, not just in this folder? (y/n)
```

If yes, append this to the global file of each agent the user has (only where
its folder, like `~/.codex/`, exists):
```
## obrain
On launch, read [absolute path]/AGENTS.md for owner context.
```

## Part E — Finish

```
Done. Brain is live.

Enable the Obsidian CLI:
  Obsidian → Settings → General → Enable Command Line Interface

Skills (by name, or just say what you want):
  /morning   — tomorrow, first thing
  /weekly    — Friday afternoon
  /recap     — end of any session
  /todo      — whenever
  /[custom]  — [one-liner]

From any terminal, `npx obrain` opens a menu: start the day in your
agent, open Obsidian, add files, check health.

Have files to bring in?
  Drop them in drop/ and say: "digest and sort drop/"
```
