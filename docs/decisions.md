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
  `attachments/` next to the note.
- **A topic's documents live in its folder, in git like notes** (a bill, a lease scan), up to 25 MB
  each, with no git-lfs and no gitignore: one place to look, one backup, and the agent reads them
  like any file. Anything that is not Markdown in the folder is a "file"; the Files card in the
  topic's conversation lists them. The costs are accepted: about twice the disk (the working file
  plus its copy in history), deleting a file frees nothing, and backups grow. So the card warns
  once history passes about 1 GB, and nightly folder and Drive copies are kept 5 deep, not 14.
  Sensitive ones go to Tier B instead ("Keep private"), linked to the topic but outside the vault.
  Larger files still stay in your file store, and notes link to them.
- The agent writes to the vault directly, one git commit per run, with the diff in the feed.
  Edits to `CLAUDE.md` wait for approval.
- **The assistant writes skills for itself, and the owner keeps them** (2026-11-22, after Hermes
  Agent). A skill is a `SKILL.md` in the vault's `.agents/skills/`, so it travels with the brain
  and every provider reads it. A conversation with the owner, and nightly dreaming, may write one
  when a way of doing something will come back; other unattended runs are not told to. A skill
  steers every later run, including the unwatched ones, so a hostile page or email must not be
  able to plant one: what the assistant writes goes to `.agents/proposed-skills/` and is used
  only once the owner keeps it in Settings, then Skills. The rule does not rest on the prompt:
  when a run ends, anything it changed under the skills folder is moved to the proposals and the
  folder is put back (`holdBackSkillChanges`). Proposals are files, not approval cards, because a
  card dies with its run and a nightly run cannot wait for an answer. "Stop using" moves a skill
  back to the proposals, so there is a way back; an agent can neither keep nor remove one.
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
- **How a hosted server is made (2026-11-23).** The address broker makes it, since it is the one
  service Majordome runs and already holds secrets: a person opens a page with an invite code
  and lands on their server, paired as its owner with the same one-time setup secret "Set up a
  server for me" uses. The page (`majord.me/start`) asks for a Majordome account first, and the
  server starts with that account as its owner, so a customer who loses every paired device
  signs in again. Making a server sits behind a small interface (create, delete, address) with Fly.io as the first host.
- **What a server is called (2026-11-23).** One the owner runs is "Your server" ("your server"
  in a sentence), not "Always-on server". One Majordome hosts is "Majordome server" ("your
  Majordome server"), drawn with a cloud. The host's name (Fly, or any other) is never shown, and
  nothing is called "cloud". A hosted server says what it is: it is created with
  `MAJORDOME_HOSTED=1` and reports that name; the app never guesses from the address. The image
  names itself "Your server", and a connection saved under the old name is shown under the new.
- **One package, one container image.** The same server runs on a Mac, a VPS or, later, a per-user
  cloud machine. **Hosted Majordome** is the next piece of work (2026-11-23): one isolated machine per user, paid, offered as a
  choice at install beside "this computer" and "your own server". To start (2026-11-23), the
  customer signs their own Claude plan in on that server, with the sign-in from the app that
  exists today, and pays Majordome for the server only: no AI in the price, no API key, no
  metering. OpenBot (openbot.run) sells hosted servers the same way. Anthropic's Claude Code
  legal page allows an end user to sign in with their own plan "including where a platform
  hosts Claude Code", but also says developers "may not collect, store, or intermediate
  Claude.ai credentials or session tokens", and the server keeps the session to run routines
  unattended; Anthropic has not confirmed that this is permitted, and it can enforce without
  notice. The owner accepted that risk to get a demo and the first few users quickly; the page
  where a customer signs in says so, and the customer can use an API key of their own instead.
  Set aside, not dropped: AI included in the price on a credential Majordome holds (about $20
  of AI, Sonnet 5.5 with Haiku 5.5 for small jobs). That shape is what the same page forbids
  ("may not pay for, resell, or intermediate Claude usage on their end users' behalf") when the
  assistant runs through Claude Code or its Agent SDK, so it waits for Anthropic's approval or
  for an engine that calls the model directly. The quotes are in `docs/whatsnext.md`.
- **No forge.** The server's vault already is the git repo. For people who edit in Obsidian on a
  laptop, the server can expose it as a git remote (advanced).
- **History is a local git repo, created silently.** No remote and no account by default. "Undo
  what the agent did" is a button.
- **Back up my brain** offers two choices: connect GitHub (device sign-in, Majordome creates a private
  repo) or choose a folder (iCloud Drive, Dropbox, USB), which gets a nightly `age`-encrypted
  `git bundle`. A secret scan (gitleaks) runs before every backup and pauses it on a hit. iCloud
  Drive comes next (2026-11-23) as a named choice that fills in the folder, offered only when the
  backup runs on a Mac: Apple gives a server no way to write to it. Google Drive comes after, for
  notes that live on a server: the same encrypted bundle, with the limited `drive.file` permission
  (needs a Google OAuth app registration).
- **Two machines stay in step directly, with no forge between them.** One server (the owner's
  computer) holds a link to the other: its address and an owner session there, kept in the secret
  store. Every 5 minutes it asks the other for what is new since the last commit it knows, rebases
  its own saved changes on top, and sends them as a git bundle over Tailscale HTTPS; the other only
  answers and only fast-forwards. The desktop app makes the link by itself when it sees the same
  brain on its own server and on another connected one, and the one-button move makes it when the
  notes are copied. The session is replaced before its 30 days run out; a link the other machine
  no longer accepts is made again by the app. A vault may have a link, a git remote, both or
  neither, and neither waits for the other.
- **The backup's history is never rewritten to fit the other machine.** The exchange with the
  other machine runs before the push to the git remote, so both normally get the same history.
  When this machine's commits are already on the remote and the other machine has new ones too
  (the two were out of touch), this machine does not rebase: the other one replays its own new
  commits on top instead. Without this the two upstreams would each ask for a different order
  forever.
- **A note changed on two machines keeps both versions as files**, the way Dropbox and iCloud do:
  what arrived keeps the name, this machine's version sits beside it as
  `name (version from <machine>, <date>).md`, and syncing carries on. An edit wins over a delete.
  Majordome never force-pushes. No conflict branches: choosing between branches is a git idea, and
  two files are something anyone can read, and the assistant can combine.
- **Phone access:** a home-screen web app over HTTPS, which iPhone web push needs. The main way
  (2026-11-22) is a public `*.majord.link` address: installing Tailscale on the phone was the step
  people would not do. Majordome runs one small hosted piece for it, the address broker in
  `infra/broker`, which hands each computer a Cloudflare Tunnel; it keeps nothing about accounts and is not in
  the path of the traffic, but Cloudflare is, and the server is then reachable from the internet
  behind its own pairing and sessions. Tailscale (`*.ts.net`) stays as the private way, and
  same-Wi-Fi pairing as a fallback without notifications. T3 Connect belongs to T3 and stays off.
- **Accounts are identity only (2026-11-23).** A Majordome account (Clerk, on `majord.me`) is
  optional on the owner's own computer and required for a hosted server. A server remembers one
  account as its owner; a device signed in to it shows a 60-second token, the server checks it
  against the account service's public keys, and hands back the one-time credential a pairing
  link carries, so nothing downstream knows about accounts. The list of an account's servers
  lives in the account's own metadata, which only its holder can write: no service of ours
  keeps who owns which server, and the account service never holds a key to a server. A
  browser signs in at `majord.me/open`, because the account service only signs in on its own
  domain and every `*.majord.link` address is another person's server.
- **Push notifications, only four kinds:** a run is waiting for you, "Start my day" finished (its
  first line), a run couldn't finish, and an agent's `notify_me` when you asked it to tell you
  (one per thread every 30 seconds). "Notifications" lists the devices that get them; "Your
  phone" is setup only.
- **"Start my day" and "Review my week" run in Auto** (the provider approves routine actions and
  asks for risky ones), or auto-accept edits where the provider or a policy ceiling has no Auto.
  "Digest my inbox" auto-accepts edits, since it reads files from outside the vault.
- **Your edits are saved too.** Every 5 minutes Majordome commits the owner's own edits as "Your
  edits", authored by the owner, after a gitleaks check. It replaces `brain-sync`.
- **GitHub backup** is an optional off-site copy, not how machines stay in step. It uses a "Majordome" OAuth app with GitHub's device sign-in (public client id, no
  secret) and creates a private `majordome-brain` repo, pushing after every save. OAuth apps can only
  ask for the broad `repo` permission; the screen says so. A vault that already pushes somewhere
  shows as backed up.
- **Folder backup** is a nightly `age`-encrypted `git bundle`, encrypted with a passphrase the owner
  chooses, kept in the Keychain and shown once as a recovery phrase to write down. Restoring one
  (welcome screen and Back up my brain) always makes a new folder, never writes into one that
  exists, and does not keep the passphrase; `age -d` and `git clone` still work without the app.
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

Upstream's mobile push and its iOS and Android apps go through T3 Connect and T3's store listings,
which a fork cannot use. Majordome's phone is a PWA plus web push for v1; a native iPhone app built
on `apps/mobile` under Majordome's own identity is M8.

The author's `brain-sync` launch agent (auto-commit, pull with rebase, pause on conflict, gitleaks
gate) is the model for Majordome's sync. It is switched off on each machine when Majordome's sync
takes over.

## Milestones

1. **M1.** Fork, hide the coding UI, open a vault as the workspace, note viewer, chat with the
   memory layers loaded, one commit per run. _Done._
2. **M2.** Explicit runner on top of scheduled tasks, default routines, inbox watcher, feed, History
   with "Undo this". _Done._
3. **M3.** Phone (PWA, web push, QR pairing, guided Tailscale) and "Back up my brain" (autosave,
   GitHub, folder), then iCloud Drive as a named choice, then Google Drive.
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
7. **M7.** Advanced. _Done:_ two machines keep the notes in step directly every 5 minutes, linked
   by the app with nothing to set up, with GitHub as an optional backup beside it; both versions
   kept when a note changes in two places. _Untested between two real servers._ _Dropped unless
   asked for:_ session replication (the app already lists every server's conversations together,
   and a conversation can be handed to another server), and a git remote served by the server for
   Obsidian on a laptop (the GitHub backup is that remote).
8. **One-button move.** _Done, for Hetzner; untested against real accounts._ "Set up a server for
   me" in Settings > Always-on server: the owner pastes a Hetzner API token and a Tailscale OAuth
   secret once; this computer's server creates a firewalled Hetzner server whose first-boot script
   installs Docker, starts the `latest` image and installs the nightly update, mints its one-time
   Tailscale key, pairs with it,
   copies the vault as a git bundle over the tailnet, carries the time zone and the GitHub backup
   sign-in, and moves routines once a provider is signed in there. Provider sign-ins are not
   copied: a Claude sign-in's refresh token must not live on two machines. Today's guide (SSH,
   Docker, auth key, pairing code) stays for other providers. A server updates
   itself: a systemd timer on the host (`deploy/install-updates.sh`, the same file for created and
   hand-made servers) pulls `latest` at 05:00 in the owner's time zone, restarts Majordome only
   when the image changed, and prunes untagged images. The host does it because a container
   cannot replace itself without the Docker socket, which is not mounted. Left: DigitalOcean,
   carrying routines the assistant set up, updating servers created before the timer existed
   (pinned image, no way in: remove and set up again), and holding an update while a run is in
   progress.
9. **M8.** Native iPhone app, after M3. It pairs with the owner's server like the PWA and adds what
   a web app can't: it opens with no connection, and what is typed offline is kept and sent when
   the server is reachable. The assistant still runs on the server: an iPhone can't run Claude Code
   or sign in with a Claude plan, and a pay-per-use API key is not the deal Majordome offers.
   Editing existing notes offline stays with Obsidian, which keeps sync conflicts off the phone.
   Built as a Majordome mode on top of upstream's React Native app (`apps/mobile`), add, don't
   edit, so its pairing, connection layer, chat and on-device database are reused and upstream
   merges stay cheap. A Swift rewrite would redo all of that.
   - **First cut, the owner's phone through TestFlight:** Majordome's name, icon and bundle ID
     under the owner's Apple account, with T3 Connect sign-in off; pair; chat with the assistant;
     Today; offline capture of a note or a request, shown as waiting to send.
   - **Where the first cut stands (2026-11-23):** it builds and runs in the iPhone simulator as
     Majordome (identifier `io.github.wozacosta.majordome.ios`, the owner's Apple team), pairs,
     lists the topics as conversations above the other chats, and opens on Today: the day's note, to-dos that can be ticked, and a box that
     adds a line to the note. A line typed with no connection is kept on the phone, shown as
     waiting, and sent when the server answers; the app reopens offline on the note it last saw.
     Requests typed offline use upstream's own message outbox. Not done: a TestFlight build, a
     run on a real phone, and the long tail of coding words on the chat screens. How it is put
     together is in `docs/whatsnext.md` ("The iPhone app").
   - **Then:** push sent by the owner's server with the owner's own Apple push key (the same four
     kinds as web push), share-sheet "Send to Majordome", and the remaining screens (topics, feed,
     routines, notes). The share sheet is also how a link reaches the reading list from the
     phone: a home-screen web app cannot appear in the iPhone share sheet, so until then links are
     pasted in the app, and no Apple Shortcut or token endpoint is built as a stopgap.
   - **Not planned:** the App Store and Android. Push for other people's phones needs a hosted
     relay, since a public app can't ship an Apple push key, and the relay waits until people ask
     for it. The PWA stays the phone for everyone else.
10. **Next, ahead of M8 (2026-11-23).** Hosted Majordome, a paid choice at install, with the customer's own Claude plan (see
    Servers and sync). Fly.io first, always on, with UpCloud as the fallback (2026-11-23; the
    reasons and the deciding test are in `docs/whatsnext.md`). No single host: in 2026 Hetzner rationed new cloud servers
    and every host raised prices as memory got dearer, so creating a server goes behind one small
    interface (what is on offer and its price, create with a start-up script, status, delete)
    with Hetzner, already built, as the first of several. The start-up script and everything
    after it (pairing, copying notes, moving routines) do not depend on the host.
    The AWS shape, if the price needs it: the same image, one container and
    encrypted volume per user, an HTTPS address per user instead of Tailscale, and machines that sleep
    and wake for routines and when the owner opens the app, to keep the price low.
