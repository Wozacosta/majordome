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
  most people never need sync. It runs on "this computer" by default (background service), with
  "Set up a server for me" (one button, Hetzner) or a terminal guide for 24/7 routines.
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
- **A server made from the app is paired without a code.** The new server gets one setup secret
  in its first-boot script and stores it as a single-use owner pairing link; the secret carries
  its own expiry, so neither a restart nor wiped state revives it. Only the computer that made
  the server holds it, and it is only reachable on the tailnet. That computer then asks the
  server for ordinary pairing links for the app and the phone.
- **Removal deletes by label, not by name.** Every Hetzner resource a move creates carries the
  move's id as a label, and each id is written to state before the next call. Removing deletes
  only resources with that label, after bringing notes and routines back.
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
  - Each server keeps its own documents in its state folder, encrypted to one `age` identity made
    on first use: in the Keychain on a Mac, in the server's secret store (a 0600 file) elsewhere.
    On a server the key therefore sits beside the ciphertext; the encryption keeps documents out
    of the vault, its sync and plain reads, not away from whoever controls the server.
  - An agent asks by name with a reason (`request_private_document`). The request is the secret
    request card with `delivery: "private_document"`, so it is in the conversation, makes the run
    "waiting for you" in the feed, pauses the routine time limit, and sends a push. No answer in
    24 hours denies it.
  - Allowed, the copy lives under the attachments folder, the one place outside the workspace
    every provider may read, in a 0700 folder; it goes when the run ends or after 15 minutes, and
    start-up clears whatever a crash left.
- **Tier C, personal passwords.** Out of scope; they stay in a password manager.

## Always-on

- v1: routines and an inbox watcher, posting to the feed. The Majordome app is the main way in.
  Telegram, email and other channels come in v2.
- **Default routines**, created when a vault is opened, on by default and editable in a Routines
  screen: "Start my day" daily at 8:00, "Review my week" Sundays at 18:00, "Digest my inbox" when
  files land in the inbox, "Tidy my memory" nightly at 3:30. Built on T3's scheduled tasks, with a turn cap each.
  Routines and one-time reminders are created and changed by talking to the assistant, beside the
  list on the Routines screen; the scheduled-task form is T3 mode only.
- **Inbox watcher:** waits for 2 minutes without new files, then starts one run for the batch.
- **Feed:** one screen, newest first: each routine or thread run with its status (done, failed,
  waiting for you), the start of the agent's reply, the notes it changed and **Undo this**.
- **Undo this** reverts that run's commit as a new commit ("Undo: …"), never rewriting history. If
  later changes touched the same lines, it stops, says so, and leaves the vault untouched.
- Unattended runs can read and write the vault and read the web. A shell, Tier B, and any outward
  action (sending email, posting) need approval.
- Approvals go to a queue and send a push. With no answer they are denied after a timeout (24h).
- **The assistant sets the app up too.** An agent reads what the settings screens show with
  `get_majordome_status` and makes one change at a time with `change_majordome_setting`. One table
  (`apps/server/src/majordome/settingsChanges.ts`) sorts every change: safe ones happen at once
  (back up now, routine limits, adding or renaming a topic); ones that are hard to take back
  (stopping a backup, forgetting a sign-in, removing a topic or a private document) first show the
  owner a card in the conversation, the secret request card with `delivery: "approval"`, and
  nothing happens without a yes; sign-ins, passphrases, adding a private document, a phone and the
  always-on server are never done by an agent, which answers with the screen to open.
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
   a Tailscale sidecar, and the guide. Claude signs in on a server from the app (a link and a code). Big files and sensitive documents wait for M5.
5. **M5.** Keychain, encrypted-file and `exec` secret providers; Tier B with `age`. _Done._
   Tier A: Keychain, encrypted file (`majord secret set`), command and environment variable sources
   beside 1Password, and the Secrets settings page is on. The encrypted file's key sits beside it,
   readable only by the server's user: it protects a copied or backed-up file, not a server that is
   already compromised. Tier B: Settings > Private documents, the two agent tools, the access log.
6. **M6.** Dreaming, search index, Overview screen. _Done:_ dreaming is a fourth default routine,
   "Tidy my memory", nightly at 3:30, skipped without a run when no note changed since the last one.
   The search index is a per-vault SQLite file in the server's state, with search in Notes and the
   `search_notes` agent tool. Overview is a health page: one verdict, then machines, routines,
   notes, AI and access, and phone, each line linking to where it is fixed; it lists secret sources
   but not whether each secret resolves, which needs a server check that reads them.
7. **M7.** Advanced: multi-machine sync, session replication, conflict branches, git remote for
   Obsidian on a laptop.
8. **One-button move.** _Done, for Hetzner; untested against real accounts._ "Set up a server for
   me" in Settings > Always-on server: the owner pastes a Hetzner API token and a Tailscale OAuth
   secret once; this computer's server creates a firewalled Hetzner server whose first-boot script
   installs Docker and starts the pinned image, mints its one-time Tailscale key, pairs with it,
   copies the vault as a git bundle over the tailnet, carries the time zone and the GitHub backup
   sign-in, and moves routines once a provider is signed in there. Provider sign-ins are not
   copied: a Claude sign-in's refresh token must not live on two machines. Today's guide (SSH,
   Docker, auth key, pairing code) stays for other providers. Left: DigitalOcean, updating a
   server in place, and carrying routines the assistant set up.
9. **Later.** Hosted Majordome on AWS, when people ask for it: the same image, one container and
   encrypted volume per user, an HTTPS address per user instead of Tailscale, and machines that sleep
   and wake for routines and when the owner opens the app, to keep the price low.
