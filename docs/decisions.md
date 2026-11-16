# Majordome decisions

Agreed on 2026-11-15. `servo` is the codename; **Majordome** is the public name.

**Brand.** Majordome is the product. `majord` is its always-on process, in the Unix daemon tradition
(launchd, systemd, sshd): the CLI command, the launchd and systemd service names and the log prefix.
The icon is a cloche, the butler's serving dome ("dome" is in the name), whose knob is a green status
light; the wordmark can show the daemon inside the name: **majord**ome.

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
- **Opinionated, for non-technical people.** Screens use plain words ("History", "Undo this",
  "Back up", "Your phone"), not git, GitHub, Tailscale, terminal or API key. Early versions may
  show some plumbing when there is no simpler way yet.

## Vault and memory

- Obsidian is optional. Majordome shows notes and images itself; an "Open in Obsidian" button is
  there for people who use it, and the vault stays Obsidian-compatible. A built-in editor comes later.
- Any vault works: folder roles (inbox, daily, projects…) come from config in `.majordome/`.
- Memory layers:
  - Always loaded: `CLAUDE.md` and `memory.md` (size-capped; when full, the agent merges entries).
  - Loaded when recent: today's and yesterday's daily notes.
  - Searched: everything else, through a SQLite full-text index the server rebuilds. Not in git.
  - Nightly dreaming: a routine moves anything worth keeping into `memory.md` or project notes.
- Standard markdown links, and Obsidian's `[[wiki links]]` resolve the way Obsidian does. Images in
  `attachments/` next to the note. Large files stay in your
  file store, and notes link to them.
- The agent writes to the vault directly, one git commit per run, with the diff in the feed.
  Edits to `CLAUDE.md` wait for approval.
- **Topics.** The sidebar's main list is the owner's long-running topics ("Accounting", "Quitting
  nicotine", "Fitness log"), not chats. A topic is one continuing conversation tied to one folder
  of the vault (an existing one or a new one); each session in it starts with that folder's notes.
  Its real memory lives in the folder (e.g. a running `log.md`), so the chat can be compacted or
  restarted without losing anything. Topics stay forever, in the owner's order, and never settle.
  Topics are defined in the vault (`.majordome/topics.json`) so they travel with the brain.
- **Recent** sits below Topics: one-off chats, which move to **Done** after 7 days. Any of them can
  become a topic in one action. Each topic shows an icon (picked from its title, changeable) and the
  gist of its latest message.
- **Words.** T3's "settle" is **Done** in Majordome ("Mark as done", the Done section, "Bring
  back"); **Archive** keeps its name and means out of sight, in Settings.
- **First topics are suggested** once from the vault's folders; the owner accepts or skips them.
- **No projects in the interface.** Majordome shows only vaults; with one vault there are no
  project names or badges anywhere and new chats and topics go into it. Several vaults get a small
  switcher.

## Servers and sync

- **One server owns everything by default.** The vault, its history, big files and sensitive
  documents live on one Majordome server; the desktop app and the phone are windows onto it, so
  most people never need sync. It runs on "this computer" by default (background service), with a
  guided "Move to an always-on server" (one-click deploy guide to a VPS) for 24/7 routines.
- **One package, one container image.** The same server runs on a Mac, a VPS or, later, a per-user
  cloud machine. **Hosted Majordome** is a later milestone, built only when people ask: one
  isolated machine per user, paid, after checking that running people's provider subscriptions on
  our machines is allowed (their own API keys otherwise).
- **No forge.** The server's vault already is the git repo. For people who edit in Obsidian on a
  laptop, the server can expose it as a git remote (advanced).
- **History is a local git repo, created silently.** No remote and no account by default. "Undo
  what the agent did" is a button.
- **Back up my brain** offers two choices: connect GitHub (device sign-in, Majordome creates a private
  repo) or choose a folder (iCloud Drive, Dropbox, USB), which gets a nightly `age`-encrypted
  `git bundle`. A secret scan (gitleaks) runs before every backup and pauses it on a hit. Google
  Drive comes after GitHub and folder: the same encrypted bundle, with the limited `drive.file`
  permission (needs a Google OAuth app registration).
- **Multi-machine sync is an advanced setting** (several servers on one vault). Any number of servers (Mac, VPS), auth always on.
  The vault syncs through a git remote. Majordome never force-pushes. When its change conflicts
  with yours, it pushes a `majordome/conflict-*` branch and the feed lets you choose.
- **Phone access:** a home-screen web app over Tailscale with HTTPS (a `*.ts.net` address), which
  iPhone web push needs. Majordome guides the Tailscale setup once and shows a QR code. Same-Wi-Fi
  QR pairing stays as a fallback without notifications. A hosted Majordome relay waits until
  people ask for it (T3 Connect belongs to T3).
- **Push notifications, only four kinds:** a run is waiting for you, "Start my day" finished (its
  first line), a run couldn't finish, and an agent's `notify_me` when you asked it to tell you
  (one per thread every 30 seconds). "Notifications" lists the devices that get them; "Your
  phone" is setup only.
- **"Start my day" and "Review my week" run in Auto** (the provider approves routine actions and
  asks for risky ones), or auto-accept edits where the provider or a policy ceiling has no Auto.
  "Digest my inbox" auto-accepts edits, since it reads files from outside the vault.
- **Your edits are saved too.** Every 5 minutes Majordome commits the owner's own edits as "Your
  edits", authored by the owner, after a gitleaks check. It replaces `brain-sync`.
- **GitHub backup** uses a "Majordome" OAuth app with GitHub's device sign-in (public client id, no
  secret) and creates a private `majordome-brain` repo, pushing after every save. OAuth apps can only
  ask for the broad `repo` permission; the screen says so. A vault that already pushes somewhere
  shows as backed up.
- **Folder backup** is a nightly `age`-encrypted `git bundle`, encrypted with a passphrase the owner
  chooses, kept in the Keychain and shown once as a recovery phrase to write down.
- **One runner, chosen explicitly.** `.majordome/runner` names the server that runs routines and the
  inbox watcher. Moving it is one button; if it is offline, the Overview says so. No heartbeat (it
  would commit every few minutes through git) and no automatic takeover in v1.
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

- v1: routines and an inbox watcher, posting to the feed. The Majordome app is the main way in.
  Telegram, email and other channels come in v2.
- **Default routines**, created when a vault is opened, on by default and editable in a Routines
  screen: "Start my day" daily at 8:00, "Review my week" Sundays at 18:00, "Digest my inbox" when
  files land in the inbox. Built on T3's scheduled tasks, with a turn cap each.
- **Inbox watcher:** waits for 2 minutes without new files, then starts one run for the batch.
- **Feed:** one screen, newest first: each routine or thread run with its status (done, failed,
  waiting for you), the start of the agent's reply, the notes it changed and **Undo this**.
- **Undo this** reverts that run's commit as a new commit ("Undo: …"), never rewriting history. If
  later changes touched the same lines, it stops, says so, and leaves the vault untouched.
- Unattended runs can read and write the vault and read the web. A shell, Tier B, and any outward
  action (sending email, posting) need approval.
- Approvals go to a queue and send a push. With no answer they are denied after a timeout (24h).
- Each server uses its own provider logins. **Limits, not money** (providers don't report cost the
  same way): an unattended run stops after 20 minutes of work (time waiting for the owner doesn't
  count), and a vault starts at most 20 unattended runs a day, then routines pause until tomorrow
  with one notification. Both are set in Routines and stored in `.majordome/config.json`. "Run now"
  is never capped.
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

The author's `brain-sync` launch agent (auto-commit, pull with rebase, pause on conflict, gitleaks
gate) is the model for Majordome's sync. It is switched off on each machine when Majordome's sync
takes over.

## Milestones

1. **M1.** Fork, hide the coding UI, open a vault as the workspace, note viewer, chat with the
   memory layers loaded, one commit per run. _Done._
2. **M2.** Explicit runner on top of scheduled tasks, default routines, inbox watcher, feed, History
   with "Undo this". _Done._
3. **M3.** Phone (PWA, web push, QR pairing, guided Tailscale) and "Back up my brain" (autosave,
   GitHub, folder), then Google Drive.
4. **M4.** One server by default: container image, "Move to an always-on server" guide, provider
   sign-in from the phone or desktop, big files and sensitive documents served by the server.
   _Done:_ the signed macOS app on GitHub Releases, `majord` as a login service
   the app installs (on by default, "Quit Majordome Completely" stops it), the container image with
   a Tailscale sidecar, and the guide. Claude signs in on a server with a pasted
   `claude setup-token` token. Big files and sensitive documents wait for M5.
5. **M5.** Keychain, encrypted-file and `exec` secret providers; Tier B with `age`.
   _Done for Tier A:_ Keychain, encrypted file (`majord secret set`), command and environment
   variable sources beside 1Password, and the Secrets settings page is on. The encrypted file's key
   sits beside it, readable only by the server's user: it protects a copied or backed-up file, not
   a server that is already compromised.
6. **M6.** Dreaming, search index, Overview screen.
7. **M7.** Advanced: multi-machine sync, session replication, conflict branches, git remote for
   Obsidian on a laptop.
8. **One-button move.** "Move to an always-on server" does it all from the Mac app: sign in to a host
   once (DigitalOcean OAuth, or a Hetzner token), the app creates the server, joins it to Tailscale
   through its API, copies the vault over the tailnet, pairs it, carries provider sign-ins and the
   time zone, and moves routines. Today's guide (SSH, Docker, auth key, pairing code) is for
   technical owners only.
9. **Later.** Hosted Majordome on AWS, when people ask for it: the same image, one container and
   encrypted volume per user, an HTTPS address per user instead of Tailscale, and machines that sleep
   and wake for routines and when the owner opens the app, to keep the price low.
