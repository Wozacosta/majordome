# Majordome decisions

Agreed on 2026-11-15. `servo` is the codename; **Majordome** is the public name.

## Product

- A public, open-source second brain and always-on agent app. A hard fork of T3 Code (MIT, T3's
  copyright notice kept).
- Majordome absorbs obrain. obrain moves to `packages/obrain` and is still published to npm as
  `obrain`. It is the one source for the skills, vault templates and setup wizard.
- Coding stays in the real T3 Code. T3's coding UI is hidden behind a flag that is never exposed,
  kept only to make upstream merges easy.
- **Add, don't edit.** `upstream` (pingdotgg/t3code) stays a git remote. T3's core (runtime,
  provider adapters, transport) stays close to upstream; brain features go in new packages and
  routes. Upstream fixes are cherry-picked.
- Provider-agnostic. Every provider T3 supports keeps working, and brain features must work the
  same with each of them. obrain becomes provider-agnostic too.

## Vault and memory

- Obsidian is the editor. Majordome shows notes read-only and opens them with `obsidian://` links.
- Any vault works: folder roles (inbox, daily, projects…) come from config in `.majordome/`.
- Memory layers:
  - Always loaded: `CLAUDE.md` and `memory.md` (size-capped; when full, the agent merges entries).
  - Loaded when recent: today's and yesterday's daily notes.
  - Searched: everything else, through a SQLite full-text index the server rebuilds. Not in git.
  - Nightly dreaming: a routine moves anything worth keeping into `memory.md` or project notes.
- Standard markdown links. Images in `attachments/` next to the note. Large files stay in your
  file store, and notes link to them.
- The agent writes to the vault directly, one git commit per run, with the diff in the feed.
  Edits to `CLAUDE.md` wait for approval.
- A thread can be pinned to a vault folder (`projects/x/`) to load that folder as context.

## Servers and sync

- Any number of servers (Mac, VPS). Reachable over Tailscale only, auth always on.
- The vault syncs with git. Default remote: a private GitHub repo. Majordome never force-pushes.
  When its change conflicts with yours, it pushes a `majordome/conflict-*` branch and the feed lets you
  choose.
- One runner lease (`.majordome/runner`, with a heartbeat) decides which server runs cron, the inbox
  watcher and dreaming. If the runner stops answering, another server takes over.
- Sessions:
  - Each thread has one owner server, and only the owner writes to its event log. Every other
    server keeps a read-only copy.
  - To continue a thread elsewhere, ownership is handed off and the new server starts a fresh
    provider session from the transcript.
  - Logs travel through a separate `brain-sessions` git repo, `age`-encrypted, pushed after every
    turn.
  - Before an event leaves the server that recorded it, secrets are removed, Tier B content is
    replaced by a placeholder, and large tool output is summarized.
- The app connects to several servers at once and lists all their threads together. New threads
  start on the server marked primary.

## Credentials and documents

- **Tier A, integration keys.** Config holds references, never values. Sources: macOS Keychain,
  encrypted file, env, `exec` (Infisical, 1Password…). Values are injected when a request goes out;
  the model and the file tools never see them.
- **Tier B, sensitive documents.** A folder of `age`-encrypted files outside the vault. It works
  on any OS, unlike a macOS encrypted disk image. One file is decrypted to a temp path after you approve, then deleted. Every
  access is logged.
- **Tier C, personal passwords.** Out of scope; they stay in a password manager.

## Always-on

- v1: cron routines (`/morning`, `/weekly`, dreaming) and an inbox watcher, posting to the feed. The
  Majordome app is the main way in. Telegram, email and other channels come in v2.
- Unattended runs can read and write the vault and read the web. A shell, Tier B, and any outward
  action (sending email, posting) need approval.
- Approvals go to a queue and send a push. With no answer they are denied after a timeout (24h).
- Each server uses its own provider logins. Each routine has a turn cap; the runner has a
  daily budget, and routines pause when it runs out.
- The Overview screen shows servers, the runner, sync state, schedules, which secrets resolve, the
  Tier B access log and index health.

## Already in upstream

Found while importing T3 Code. Reuse these instead of building them:

| Planned               | What T3 Code already has                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Cron routines         | Scheduled tasks: once, interval, time of day, webhook (`apps/server/src/scheduledTasks`)                                            |
| Always-on server      | `t3 service install` (launchd / systemd), see `docs/user/background-service.md`                                                     |
| Secret references     | Secret providers with references and a provider registry (`packages/secret-provider-*`), 1Password today, plus secret request cards |
| Thread handoff        | Portable handoffs carry context to a new provider session (`docs/user/portable-handoffs.md`)                                        |
| Multi-server client   | Environments: one client, several servers                                                                                           |
| Tailscale and pairing | `packages/tailscale`, pairing links, `t3 up`                                                                                        |
| Session store         | Event-sourced threads in SQLite (`apps/server/src/orchestration-v2/EventStore.ts`)                                                  |
| Web app manifest      | `apps/web/public/manifest.webmanifest`                                                                                              |

Mobile push and the iOS and Android apps go through T3 Connect and T3's store listings, which a fork
cannot use. Majordome stays with a PWA plus web push for v1.

## Milestones

1. **M1.** Fork, hide the coding UI, open a vault as the workspace, chat with the memory layers
   loaded, one commit per run.
2. **M2.** Runner lease on top of scheduled tasks, inbox watcher, feed.
3. **M3.** PWA, web push, Tailscale defaults.
4. **M4.** Keychain, encrypted-file and `exec` secret providers; Tier B with `age`.
5. **M5.** Dreaming, search index, Overview screen.
6. **M6.** Session replication, conflict branches.
