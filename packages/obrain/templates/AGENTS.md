# AGENTS.md — obrain

Instructions for any AI agent working in this brain (Claude Code, Codex, Cursor,
OpenCode and others). CLAUDE.md only imports this file; edit this one.

## Owner Profile
[Run /brain-setup to generate this. You'll answer a few questions
and the agent builds a profile that loads automatically every session.]

## How This Brain Is Organized

  drop/       — incoming files land here (PDFs, docs, anything)
  daily/      — one note per day, named YYYY-MM-DD.md
  weekly/     — end-of-week digests, named YYYY-Www.md
  projects/   — one subfolder per active project
  refs/       — long-term reference material and research
  done/       — completed work gets moved here, nothing gets deleted
  todo.md     — single task list, managed via /todo
  memory.md   — what the agent has learned about how the owner works

  .agents/skills/  — the skills below, one folder each (shared by every agent)
  .majordome/      — settings for the Majordome app; leave it alone

## Memory
- memory.md is the only memory. When you learn something worth keeping about the owner,
  write it there, never into your own app's memory feature.
- Keep memory.md short: it is loaded at the start of every session. Merge or rewrite
  entries instead of only appending.

## On Launch
- Open daily/[today].md or offer to create it
- Scan drop/ for new files and read them (handles PDFs, images, anything)
- Check todo.md for overdue or due-today items
- Mention anything relevant from recent project folders

## When Working on a Project
- Read projects/[name]/ before doing anything
- Cross-reference with todo.md for related tasks

## When Writing
- Read the last few daily notes to match tone and voice
- Check refs/ for relevant background

## When Files Land in drop/
- Read them natively (no scripts needed)
- Summarize into markdown
- Ask where to file them or infer from content

## Housekeeping
- New stuff → drop/ first
- Daily notes → daily/YYYY-MM-DD.md
- Weekly reviews → weekly/YYYY-Www.md
- Done with something → move to done/
- Keep this file current as workflows evolve

## Skills
Each skill can be run by name (/name in Claude Code, $name in Codex) or
just by saying the phrase next to it, in any agent.

- /brain-setup   — one-time onboarding, builds the owner profile ("set up my brain")
- /morning       — start-of-day ritual with context ("start my day")
- /weekly        — end-of-week review and planning ("review my week")
- /recap         — save this session to the right place ("save this session")
- /todo          — manage tasks: add, finish, prioritize ("add a todo", "what's on my plate")
- /digest        — read and summarize a folder of files ("digest drop/")
- /import-vault  — merge notes from another Obsidian vault ("import my old vault")
