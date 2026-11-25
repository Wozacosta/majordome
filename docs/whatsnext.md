# What's next

Things found and left for later. Each says what it is, why it waits, and where to start.
Remove an entry when it is done.

## Before going live

### Put the Intel Mac build back

Since 0.10.22 a release builds for Apple silicon only, which roughly halves the wait for an
installer while Majordome has one user. Before anyone else is invited:

- In `.github/workflows/majordome-release.yml`, uncomment the `x64` entry of the build matrix.
  The step that merges the two update feeds already handles both cases.
- On the site (`site/index.html`), put the "Intel Mac?" link to `/download/intel` back under the
  download button. The route itself (`site/vercel.json`, `site/api/download.mjs`) was left in
  place.
- In `README.md`, restore "Apple silicon | Intel" in the badge and the Intel link in the install
  steps; in `docs/user/install.md`, name the `x64` installer again; in
  `docs/operations/03_release.md`, drop the note that Intel is off.
- Cut a release and check that `latest-mac.yml` lists both architectures and that both installers
  open.

An Intel Mac that installed 0.10.21 or earlier stays on that version until then: the update feed
no longer offers it anything.

## Dropping T3 Code weight (audit of 2026-11-22)

Rules that came out of the audit: keep every AI adapter, never delete upstream source, cut only
in Majordome-owned places (the `hidesCodingTools` flag, build stubs, packaging exclusions, repo
settings).

### Small file cuts, about 20 MB of the 527 MB app

All go in `DESKTOP_FILE_EXCLUSIONS` in `scripts/build-desktop-artifact.ts`. Sizes were measured
on the installed 0.10.17 app.

| What                                                                                                    | Size    | Before cutting                                                                           |
| ------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| Two unused builds of Cursor's SDK (`dist/bundled`, `dist/cjs`); the adapter stays                       | 13 MB   | Send a Cursor chat on the built app. It breaks if anything loads the SDK with `require`. |
| Playwright's own viewer and report screens (`playwright-core/lib/vite`)                                 | 3.9 MB  | Open a page in the side browser on the built app.                                        |
| zod's TypeScript sources and tests (`zod/src`)                                                          | 3.1 MB  | Nothing; only a dev-only export reaches them.                                            |
| Docs and native source folders (`undici/docs`, `koffi/vendor`, `node-addon-api` headers, `objc-js/src`) | 1.5 MB  | Start the app once.                                                                      |
| `node-pty` Linux prebuilds in the Mac app                                                               | 0.15 MB | Nothing.                                                                                 |
| `koffi` and its Mac binary                                                                              | 2.2 MB  | Find which dependency loads it first. Do not cut blind.                                  |

The same files are in the server image, which does not pass through that list; pruning there
goes in the `Dockerfile`.

The local Mac build fails on this machine until Rust is 1.95 or newer, so a packaging change
can only be checked on a release build.

### A product choice, not a cleanup

The Word, Excel and PowerPoint viewers (49 MB), their Chinese, Japanese and Korean fonts
(35 MB) and other Office fonts (16 MB) are the largest thing left. Dropping them means notes
folders can no longer preview Office files.

### Still pointing at T3 Code

- **"Scan to get the app" on the Welcome page.** The code opens T3 Code's phone app
  (`MOBILE_APP_URL` in `apps/web/src/branding.ts`). Change it when the iPhone app exists.
- **`docs/user/`.** Only `install.md` is rewritten. `updating.md`, `faq.md`, `triage.md`,
  `remote-access.md` and others still describe T3 Code and its `t3` command.
- **SSH computers.** The option is hidden when adding a computer. The code behind it still
  downloads a command-line build Majordome does not publish, and its failure message names
  T3 Code's install script (`packages/ssh/src/tunnel.ts`).
- **The triage tool.** Hidden on the start-up error screen and answered by a message in
  `majord triage`. Its prompt and service still name T3 Code's repository
  (`apps/server/src/triage/`).
- **The hosted app's empty state** (`InstallT3Commands.tsx`) shows T3 Code's install commands.
  Majordome has no hosted app, so nobody sees it today.
- **Coding guidance in the chat instructions.** `orchestrationInstructions.ts` still explains
  worktree chats and says "Ordinary coding tasks need no T3 tools". About 5 KB per chat; the
  file differs from upstream by one line, so trimming it costs merge conflicts.

### Not checked

- **Model-behaviour evals** for the removed instruction text were not run: the repo has no API
  keys. See `evals/README.md`.
- **A git fetch every 30 seconds on the notes folder.** Read from the code
  (`VcsStatusBroadcaster.ts`), but 70 minutes of the live server's log showed one fetch. Left
  alone; look again if the backup remote shows heavy traffic.
- **Hidden settings pages** (Source control, Worktrees, Devices, Diffs) are gone from the menu
  and search but may still open by address.
- **The tool-list budget** in `agentContextBudget.json` counts every registered tool, including
  the hidden coding ones, so it overstates what a chat is told by about 13 KB.

## What the AI costs: measure, then improve

Hosted Majordome sells about $20 of AI a month (see `docs/decisions.md`), so what a chat message
and a routine run cost decides whether that price holds. It is part of the hosted work, and the
saving applies to anyone on an API key.

Measured on 2026-11-23 from one week of the owner's use, all on Opus 5.5 (66 chat turns on the
Mac, 29 chat turns and 14 routine runs on the server), priced at list API rates:

| Per          | Opus 5.5       | Sonnet 5.5     | Haiku 5.5   |
| ------------ | -------------- | -------------- | ----------- |
| Chat message | $0.21 to $0.34 | $0.10 to $0.17 | about $0.01 |
| Routine run  | $0.39          | $0.19          | about $0.01 |

About 80% of that is not the conversation. It is writing the instructions, tools and memory to
the provider's cache: 20,000 to 37,000 tokens, at twice the input price because they are cached
for an hour.

Looked into on 2026-11-23 (four read-only passes over the code, the transcripts and the usage
rows; nothing was changed in how a turn is sent):

- **The cache is not thrown away each turn.** Turns that follow each other within the hour read
  it. The large writes come from two places: the first turn of a session, and coming back to a
  conversation after the hour has passed, which was 52% of all cache writes that week. An
  earlier note here guessed something early in the prompt was changing; that was wrong.
- **What fills the first request, about 45,000 to 55,000 tokens.** Roughly 65% is Claude Code's
  own tools and listings, including its Artifact tools (8,000 to 13,000 tokens) that Majordome
  never uses. About 16% on the owner's Mac is his personal Claude plugins and settings, loaded
  because the session reads `~/.claude`. About 18% is Majordome's own text.
- **"Other requests as large again as the chats" was earlier turns counted again**, fixed on
  2026-11-24. Claude Code restores a resumed conversation's totals into its ledger, so the
  first turn after a restart was charged with every turn before it. In the owner's data, 13 of
  the 24 turns with an "other" figure matched the sum of the earlier turns to the token, and
  97% of the 21.6 million "other" input tokens were that. Upstream's recorded resumed session
  (`testkit/fixtures/claude_idle_resume`) starts its ledger at zero, which is why a first fix
  was reverted; the rule now accepts a resumed process's first ledger only when it equals the
  turn's own usage. About 650,000 tokens of real side requests are left, 4% of the chats.
- **The small jobs already run on Haiku** (key facts, "In short", titles), through the
  provider's fallback. Only chat and routines are on Opus.

Done on 2026-11-24, in `apps/server/src/majordome/claudeSessionCuts.ts`, each measured on a
first request of 43,755 tokens (Haiku, a small notes folder, the owner's Mac):

- **The Artifact tools are no longer offered:** 12,346 tokens less.
- **The owner's personal Claude Code settings are not loaded** (plugins, skills, hooks, personal
  MCP servers): 9,899 less. Turning off only the two plugins saved 1,601, so the whole "user"
  source is left out. The notes folder's own `.claude` is still read.
- **Routines keep their cache five minutes,** not an hour.

Still proposals, each the owner's to decide:

1. **Sonnet 5.5 for chat and routines by default**, Opus on request. About half the cost. The
   owner chose to stay on Opus for now (2026-11-24).
2. **Name the built-in tools a session may use** instead of taking Claude Code's whole list.
   About 5,300 tokens.
3. **Run one week on a real API key** and check these figures against the bill, then show cost
   per run on Overview.

## Hosted Majordome: where the servers come from

Next in line since 2026-11-23 (see `docs/decisions.md`). What was learned that day,
so it is not looked up twice:

- **Size.** The owner's server uses about 425 MB of memory at rest and 1.5 GB of disk, and is
  listening 3 seconds after it starts. A 2 GB server is enough.
- **Prices moved a lot in 2026** as memory got dearer. https://www.eucloudcost.com/price-index/
  tracks European list prices weekly from an open dataset; it has no stock, no US hosts, and
  does not say which hosts can create a server by API with a start-up script.
- **Candidates for a plain server, European-owned:** Hetzner (CX23, 4 GB, €5.49; built, but new
  servers have been rationed since June 2026), UpCloud (Starter 2 GB, €6.00, hourly, disk
  included), Scaleway (DEV1-S, €6.55 without a disk). OVH's VPS-1 is the cheapest at €4.49 but
  has no hourly price, and creating one by API with a start-up script is unconfirmed.
- **Machines that sleep** (Fly.io Machines, about $0.15 per GB a month while stopped) would cut
  an idle customer to a dollar or two. Open questions: time from asleep to usable on a small
  machine, what keeps a server awake (an open app, the 5-minute notes exchange), who wakes it
  for routines, and that Fly is a US company.
- **Fly, Railway and UpCloud compared (2026-11-23, from their docs; nothing was run).**
  - _Fly Machines._ Always on it is the dearest: a 2 GB machine is $13.39 a month in the US
    and about 15% more in Frankfurt. Stopped or suspended it costs storage only, $0.15 per GB,
    so a customer whose server runs two hours a day comes to about $3. It starts from the
    image in seconds with no start-up script, and gives each app an HTTPS address, so no
    tunnel and no address from the broker. What sleeping needs: traffic must come through
    Fly's proxy to wake it (a tunnel dials out and cannot), the server must stop itself when
    idle (Fly's own idle stop looks only at traffic and would cut a routine short), and
    something must start it for routines (`POST .../machines/{id}/start`). Suspend is limited
    to 2 GB of memory. A volume lives on one physical disk with daily snapshots kept 5 days.
    Not checked: that the built-in browser's sandbox runs there.
  - _Railway._ Not a fit. Its rules forbid "reselling compute resources" and say to ask
    first; Pro stops at 100 services; a service sleeps only after 5 to 10 minutes with no
    outbound packet, which the notes exchange never allows; services are containers, not
    machines; one European region. Always on at the server's 425 MB it would be about $6.
  - _UpCloud._ A plain server like Hetzner's, so the same code shape: `POST /1.3/server` with
    `user_data` and `metadata: yes`, labels to find it again, a firewall per server. About €6
    for 2 GB by the price index above; its own price page refused to load. Not found: what a
    stopped server costs, and the default limit on servers per account.
- **How OpenBot hosts (2026-11-23, from its public `docs/hosted-servers.md`).** It answers the
  open questions on sleeping, in production. One machine per account: a Leaseweb server taken
  from a pool kept ready (Netherlands and US), or a boat.dev sandbox when the pool is empty,
  moved to a pooled server later. A Cloudflare Worker with a database creates, stops and wakes
  them and takes payment. The server reports to it when it is in use and when its next routine
  runs; the Worker stops a server after 15 minutes without use, wakes it up to 10 minutes
  before a routine, and the app shows "asleep" and wakes it on the next click. So the server
  does not stop itself: the service that can also start it decides. Its code is licensed for
  non-commercial use only: the design can be learned from, the code cannot be copied. Leaseweb
  is Dutch, so a European-owned candidate not in the list above.
- **boat.dev (2026-11-23, from its site and docs; nothing was run).** A persistent Linux
  machine per sandbox, made, stopped and resumed by API, in Germany, Finland and France. The
  smallest is 2 vCPU and 4 GB at $0.018 an hour: about $13 a month always on, about $1 at two
  hours a day, and a stopped one has no charge. Plans start at $20 a month (100 running at once,
  200 starts a day). Its terms allow giving end users their own sandboxes and charging for it.
  Against it as the home of a customer's notes: the terms say it is not guaranteed "suitable for
  production" and that boat may stop or delete; a stopped disk is kept "at least 14 days", so an
  idle customer must be woken to keep it; memory is not saved and the resume time is not given;
  the address changes at each resume; a data processing agreement is on request; it is a young
  US company. OpenBot uses it only when its own pool is empty. A better fit than Fly for the
  one-day trial of sleeping machines: European regions, and a 7-day trial with 25 hours.
- **GDPR.** Storing in Europe is not required, but it is the simplest position. The larger
  transfer is the AI: notes go to the model provider. Before a paying customer: a privacy
  policy, a data processing agreement with the host, the model provider, Cloudflare and the
  payment provider, and an hour with someone who does this for French small businesses.

**Decided on 2026-11-23: start the way OpenBot does.** The customer signs their own Claude plan
in on the hosted server and pays for the server only. It needs no credential of ours, no cap
and no metering, so the capped credential per customer below is set aside until AI is included
in the price. The risk is in the quotes that follow and was accepted for a demo and the first
few users. What it asks of the work: the sign-in page tells the customer that Anthropic has not
confirmed this use and that their plan's limits are meant for ordinary individual use, and an
API key of their own stays possible. The price is then the server plus a margin.

**Anthropic's terms, read before that decision.** Read on 2026-11-23 at
https://code.claude.com/docs/en/legal-and-compliance (quotes are theirs):

- Running Claude Code in a product, "e.g. in hosted sandboxes or other agent infrastructure",
  "requires agreeing to our Commercial Terms of Service", and the program must be unmodified.
- "Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf.
  Each end user must authenticate with their own Anthropic API key, Claude subscription plan
  credentials, or 3P inference provider credential". The chosen shape (Majordome holds the
  credential, AI in the price) is that, when the assistant runs through Claude Code or the
  Agent SDK, which is what the Claude adapter uses. This bears directly on the capped
  credential per customer described below.
- An end user may sign in "to the unmodified Claude Code binary with their own Claude
  subscription, including where a platform hosts Claude Code". But developers "may not collect,
  store, or intermediate Claude.ai credentials or session tokens": the sign-in from the app
  relays a code, and a hosted server keeps the session for routines. The consumer terms also
  bar automated access outside the API and commercial use.
- So neither shape is clearly allowed for a hosted server that runs routines unattended. Ways
  out, to put to Anthropic before building: an explicit approval; the customer's own API key;
  calling the model API directly with Majordome's key and Majordome's own tools, not Claude
  Code; or another provider for hosted customers.
- OpenBot (openbot.run, hosted servers from €30 a month without AI) lets customers sign a
  Claude plan in on its servers, and its own `docs/provider-terms.md` says Anthropic has not
  confirmed that this is permitted.

No customers set up by hand (2026-11-23): a customer's server is created when they ask for it.
"Set up a server for me" cannot do that as it is. It runs on the owner's computer with the
owner's own Hetzner key and puts the server on the owner's Tailscale network; a customer has
neither. What creating one for a customer needs:

- **A service that holds Majordome's host keys** and creates the server. The address broker
  (`infra/broker`) is the natural place: it is already deployed, already holds a secret, and
  can make the server's `majord.link` address in the same request and hand the connector token
  to the start-up script, so the server needs no Tailscale and no open port.
- **Something that says who may ask**, or anyone can run up the bill: an invite code first,
  payment later.
- **A start-up script without Tailscale** (`cloudInitFor` in `serverMovePlan.ts` and
  `deploy/docker-compose.yml` both assume it), carrying the connector token and the setup
  secret. No AI credential goes in it: the customer signs in from the app.
- **The app's side:** a "Majordome hosts it" choice that sends the invite code, then pairs with
  the setup secret and copies the notes, as the move does today from the `pair` step on.
- **One capped AI credential per customer.** Checked against Anthropic's docs on 2026-11-23:
  - A classic API key cannot be created by API (keys can only be listed, renamed and turned
    off), so "one key per customer" as written means clicking in the Console.
  - What can be created by API is better: a workspace per customer (1,000 per organization by
    default) and a federation rule tied to that workspace. The service signs a short identity
    token for a server, the server trades it for an Anthropic token that lasts 1 to 24 hours,
    and Claude Code reads the federation variables itself (`ANTHROPIC_FEDERATION_RULE_ID`,
    `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_IDENTITY_TOKEN_FILE`), though not in bare mode. No
    long-lived secret sits on a customer's server, and usage is reported per workspace.
  - The cap: a monthly spend limit per workspace exists, but setting it by API is an early
    access preview to ask Anthropic for; otherwise it is set in the Console. Without it, the
    service enforces the cap: it reads each workspace's cost and stops signing identity tokens
    for one that is over, which cuts it off within the token's lifetime plus the reporting
    delay (about 30 minutes for token counts, 4 to 24 hours for cost). Per-workspace rate
    limits can be set by API and bound the overshoot.
  - Needed once by hand: a Console organization (an individual account has no Admin API) and
    one admin federation rule made in the Console.
  - Not tried against a real organization.

**Decided on 2026-11-23: Fly.io first, always on.** It runs the image as it is and gives each
server an HTTPS address, so it is the least to build for a demo and the first few users;
sleeping can be turned on later without moving anyone. Hetzner is out for now: its status page
still says, since 26 June 2026, that it restricts "the creation of new cloud servers for both
new customers and some of our existing customers", and its cost-optimized line is marked
"Currently not available". UpCloud is the fallback, and the answer if a European-owned host is
wanted before real paying customers. A customer's notes are plain files with a backup, so
moving one to another host later is a copy.

The test that decides it, on one machine. Run on 2026-11-23 with the released image (0.10.26),
2 shared CPUs and 2 GB in Paris; these are the commands that worked:

```sh
fly apps create --generate-name --org personal
fly volumes create data --size 3 --region cdg --app <app> --yes
fly machine run ghcr.io/wozacosta/majordome:latest --app <app> --region cdg \
  --vm-memory 2048 --vm-cpus 2 --vm-cpu-kind shared --volume data:/data \
  --port 443:3773/tcp:http:tls --port 80:3773/tcp:http \
  --env MAJORDOME_PUBLIC_URL=https://<app>.fly.dev --restart always --detach
fly ips allocate-v4 --shared --app <app> && fly ips allocate-v6 --app <app>
```

1. **Passed: Majordome starts, answers over HTTPS and pairs.** No start-up script, no Tailscale,
   no tunnel. It was listening about 4 seconds after the machine started and printed its pairing
   link with the `fly.dev` address. The volume was writable by the image's `node` user with
   nothing done. 605 MB of 1,970 MB in use at rest. The owner paired from a browser.
2. **Passed: Claude signed in from the welcome page and answered.** The sign-in is kept on the
   volume (`/data/.claude`).
3. **Not done yet:** a browser tab opens from the phone on a chat that runs there. A good sign:
   the log has no "this host blocks the sandbox" warning, which the OVH server prints.

Also seen that day:

- **A Fly account without a card stops every machine after 5 minutes** ("Trial machine
  stopping"), and starts it again on the next request. Pay As You Go lifted it without
  recreating the machine.
- **Stop and wake works.** After such a stop, a request started the machine in under a second
  and Majordome was listening 9 seconds later. The visitor who wakes it gets a 503 page from
  Fly's proxy in between, which is what a "waking your server" screen has to cover. Data and
  the Claude sign-in survived every stop.
- **Each start prints a new pairing link**; a link made with `majord pair` kept working across
  a restart.
- **The new sign-in (0.10.28) was used for real** on a fresh machine: a link, a code, Ready.
  Left to tidy: its card still says "Claude says Ready above in a moment" once Claude is Ready.
- The test server that is kept is the app `patient-petal-578`, on Pay As You Go.

So Fly is the host. What the welcome page got wrong on a server, seen in that run:

- Claude's sign-in ran in a hidden terminal and said a page had opened in the browser. Fixed
  after 0.10.27: a server shows a link to open and a box for the code.
- "A new folder called Majordome in your home folder": a hosted customer has no home folder
  there. Fixed: a server created with `MAJORDOME_HOSTED=1` is named "Majordome server" and its
  welcome page says the notes folder is on it. Whatever creates a hosted server must set that
  variable.
- Codex, "Use a different AI", "Choose folder" and restoring from a folder all assume the
  owner's own computer. Fixed: a Majordome server's welcome page shows Claude, "Start new
  notes" and restoring from Google Drive, and its "Your server" settings page offers nothing to
  set up.
- The start-up log warns that the address "uses plain HTTP" although Fly serves it over HTTPS.

**Built on 2026-11-23: an invite code makes a server.** The address broker (`infra/broker`,
live at broker.majord.link) has `GET /start`, the page a person with a code opens, and `POST
/v1/hosted`, which spends the code on one Fly app with a 3 GB volume and a 2 GB Machine running
the released image, marked `MAJORDOME_HOSTED=1` and carrying a one-time setup secret. The page
waits until the server answers and opens it paired as its owner. Run for real through the page:
a new server about half a minute after the code, with the welcome page of a Majordome server,
Claude's link-and-code sign-in, and new notes made. Making invites and removing a server are
commands in `infra/broker/README.md`.

What that first version does not do, in the order I would take them:

- **Updates: done.** Every night the broker reads the latest release and restarts each hosted
  server that reports another version. Run for real: a server went from 0.10.29 to 0.10.30 in
  36 seconds, and a second run restarted nothing. It names the image by its tag, since a
  machine updated with `fly machine update` has its image pinned to a digest and would otherwise
  restart on the same one. It does not yet wait for a run in progress to finish. A server made
  by hand is in its list only if it has a row in `hosted_invites`; the demo server has one.
- **Phone setup: done.** A hosted server reports its own address as the phone's, and the Phone
  page goes straight to the code to scan. Seen on a real hosted server.
- **From the iPhone app: built, not run for real.** The phone has its own "A Majordome server"
  screen that spends a code, waits, connects the phone as the owner and then opens the server's
  welcome page in the browser. See "The iPhone app" below.
- **Backups: a first layer is on.** Fly copies each volume daily; new servers keep those copies
  30 days. Restoring one was tried on a throwaway server on 2026-11-23 and worked: a file changed
  after the copy came back as it was, and the server kept its identity and its owner's access.
  It is done by hand (steps in `infra/broker/README.md`). Not done: a backup the customer owns
  (Google Drive, GitHub) is still theirs to turn on.
- **The address** is `majordome-<10 characters>.fly.dev`, which names the host. A name under a
  domain of ours needs a certificate per server on Fly. The owner has `majord.me` (the landing
  page today) and `majord.link` (the tunnels' addresses); a subdomain of `majord.me` is the
  natural home, since `majord.link` hands its names to tunnels.
- **Coming from the Mac app: done.** "Move my notes to your Majordome server" in Settings > Your
  server reuses the move to a server of your own from its pairing step on, with a one-time code
  the app asks the server for. Run for real between this Mac and a server on Fly: notes and
  history copied in about a second, a note written on the server brought back. Not tried for
  real: moving routines, which needs Claude signed in on the server. The server must be added
  to the app first, and must not have had "Start new notes" pressed, or it ends up with two
  notes folders.
- **Payment, and removing a server,** are by hand. `MAX_HOSTED_SERVERS` (10) bounds the bill.
- **The built-in browser.** On Fly, `majord browser setup` reports that Chrome's sandbox is
  allowed, so it should work; no one has opened a tab from a phone yet.
- **Guessing codes.** A code is refused the same way whether unknown or used, and there is no
  limit on tries, so codes must be long and random.
- **Accounts (looked at 2026-11-23, not built).** An invite code leads to a server once; after
  that nothing leads back to it, so a new phone or a wiped one needs a code from the server's
  Phone page. An account fixes that ("sign in, here is your server") and is where payment hangs
  later. Clerk fits: upstream already carries it for T3 Connect in the web, desktop and phone
  apps (native Apple and Google sign-in, token storage), switched off here only because no key
  is set. What it takes: a Clerk application of Majordome's own; `hasCloudPublicConfig` (web and
  phone) no longer requiring a relay address; Sign in with Apple enabled for the bundle ID and
  `webcredentials:<Clerk domain>` put back in `majordome/identity.ts`; and in the broker an owner
  column on `hosted_invites`, a check of the Clerk token against the application's public keys,
  and `GET /v1/hosted/mine`, which needs a way to give an existing server a fresh setup secret.
  Dexie Cloud is not the tool: it syncs a browser database between devices, and Majordome's data
  is a notes folder on a server; its login would add a second copy of nothing.
- **Before anyone pays:** the privacy policy and agreements above, and Anthropic's answer.

Later, in this order when each is needed: sleeping (the service stops and wakes machines, as
OpenBot's does), a second host behind one interface, a pool of ready servers.

## Selling servers: before telling strangers

Paying on [majord.me/start](https://majord.me/start) is live and has one customer, the owner.
These came out of two reviews on 2026-11-24 and wait until the page is shown to other people.

- **Alerts.** The broker can post a line when the hourly pass fails, and posts nowhere: the
  `ALERT_URL` secret is not set (`infra/broker/README.md`, "Paid servers"). Pick where it goes
  (a private ntfy topic is the least work) and set it. A failed settle right after a Stripe
  notice is only logged; the hourly pass is what reports it.
- **The 14-day refund.** `site/terms/index.html` promises one and nothing performs it: the
  cancel page ends the subscription at the period's end. Either refund by hand and be told when
  one is due, or have the broker do it.
- **Tax and seller wording.** The page says "Tax included" and the terms say Stripe may appear
  as the seller, while Managed Payments is off and Stripe computes no tax. For the accountant:
  the VAT mention and the EU cross-border threshold. Turn on `STRIPE_MANAGED_PAYMENTS` once
  Stripe approves the account.
- **A French seller's flow,** to check with a professional: a French version, a pay button that
  states the obligation to pay, a withdrawal form, the seller's address before purchase, the
  SIRET and a consumer mediator on the terms page.
- **The margin.** A reviewer guessed a server costs 10 to 11 euros a month on Fly against a
  price of 12. One Fly invoice settles it.
- **Stopped servers hold a place** under `MAX_HOSTED_SERVERS` for the 30 days they are kept.
- **A new email is a new free trial** (`trialFor` in `infra/broker/src/billing.ts`).
- **No way to buying from the landing page,** which still says a server is about 5 euros a
  month; the account page still says hosting is by invitation.
- **Roll the live Stripe key** "Majordome broker": its value passed through an agent's
  transcript on 2026-11-24.

The iPhone purchase is not ready to submit. In the broker: App Review buys in Apple's sandbox,
which is switched off (`APPLE_ALLOW_SANDBOX`); placeholder key ids switch selling on; a purchase
with no account token is dropped; an unknown transaction gets the wrong message. In App Store
Connect: the Paid Apps agreement, the subscription at the web price with a one-week free offer,
the billing grace period, the In-App Purchase key, the notice address, a sandbox tester, and a
demo account for the reviewer.

## Trust and transparency: a hosted server is the customer's

The question a customer asks: how do I know the person running my server is not reading it or
changing it? Today the honest answer is that nothing technical stops it. The owner of the Fly
organisation can open a shell on any server, read its disk and its daily copies, and the nightly
update runs whatever image the latest release names. The customer's Claude sign-in sits on that
disk too. What exists already: the code is public, the broker holds no notes, and anyone can
leave with **Settings > Back up my brain** and run Majordome on their own machine.

It cannot be proved away while the server has to read the notes to work, so the aim is to say it
plainly, make it checkable, and narrow it. In order of what each buys for its cost:

1. **Say it.** Done on 2026-11-25: `site/trust/index.html`, linked from `/start` and the
   privacy page. Its promises are the owner's; the wording has not been read by a lawyer. Still
   missing for someone who already has a server elsewhere: an install from the app, given the
   server's address, in place of the seven steps by hand.
2. **Show what runs.** The server shows the image digest it runs and the release it came from,
   and the release shows the same digest, built by public CI from the public source. Start at
   `image-digest.txt` in the release and `imageFor` in `infra/broker/src/worker.ts`. Add build
   provenance (GitHub's attestations) so the digest can be tied to a commit by anyone.
3. **Updates the customer can see and hold.** The nightly update is the one way new code
   reaches a server. Show what changed, and let the owner of a server delay or refuse it.
4. **A record of access.** Fly keeps none that can be shown (below). A record kept on the
   server itself proves little: whoever has a shell can edit it.
5. **Encryption with the customer's key.** Protects the disk copies and a stopped server, not a
   running one, which holds the key in memory. Real work, and it makes a lost key a lost brain.
6. **Deletion that can be checked.** What is deleted when, including Fly's disk copies, stated
   with dates in the account page.

A different answer, raised by the owner on 2026-11-25: **the server belongs to the customer.**
It is made in the customer's own hosting account, so the operator has no shell, no disk and no
disk copies to read. It does not remove trust by itself: a server that updates itself from
Majordome's releases still runs whatever is released, so it only holds with step 3 above (the
customer approves updates, or they are checked against public build provenance). It is another
product: what is sold is the setup and the software, the customer has one more account and one
more bill, and a server that will not start can only be looked at if they let the operator back
in.

Checked on 2026-11-25 by two research agents, from the sources named; not re-read by hand:

- **On Fly the operator cannot lock himself out.** Fly's security questionnaire
  (`fly.io/legal/security-questionnaire`) says SSH cannot be disabled per app, a deploy token is
  enough to open a shell, and disk keys are held by Fly with no customer-held option.
- **There is no record of access to show a customer.** The same page says there is no
  organisation activity log and no SSH session log. Step 4 above is therefore not possible on
  Fly today.
- **An app can be handed over:** `fly apps move`, with its disk, secrets and domains, a few
  minutes down. The mover must belong to both organisations, so the customer invites the
  operator, which the free plan does not allow.
- **No "let Majordome in once" button on Fly.** Its OAuth only reads identity; the customer
  would paste a token with a short expiry and revoke it after. DigitalOcean has scoped OAuth
  for exactly this.
- **Hosted servers do not update themselves today:** the broker does it with the organisation's
  token (`updateServer` in `infra/broker/src/fly.ts`). A customer-owned server needs its own.
- **How Obsidian Sync does it:** notes are encrypted on the device with a key made from a
  password the company never has, so its servers only hold what they cannot read; two outside
  audits are published, and a script lets anyone check their own traffic. It works because that
  server only stores. Majordome's reads the notes to run the AI, so the same cannot hold while
  it runs. What carries over: disk copies and a stopped server under the customer's key, and
  notes synced between devices with no server at all.
- **Proving it is possible in principle,** with attested hardware and published reproducible
  images (Apple's Private Cloud Compute, Tinfoil), on AWS or Azure and not on Fly. A large
  project for one person.
- **What others in the same position say:** PikaPods promises staff never open customer data
  unless asked; Proton's AI product says plainly that the model sees the message.

## Phone

Saving a link to the reading list from a phone waits for the iPhone app's share sheet. See the
M8 note in `docs/decisions.md`.

## Reading list, from the laterlist comparison

Not asked for yet: a calendar of finished items, images in notes, playlist import, an "action"
kind, publishing a list, filing one item under several subjects, and Empty Trash.

## The iPhone app

Started 2026-11-23 (M8 in `docs/decisions.md`). What a later session needs to know:

- **Identity is applied after upstream's config.** `apps/mobile/majordome/identity.ts` turns the
  finished Expo config into Majordome's (name, bundle identifier, Apple team, the cloche icon,
  no over-the-air updates, no associated domains). `app.config.ts` only calls it. The URL schemes
  stay `t3code*`: pairing codes and link handling key on them, and they are never shown. If T3
  Code's own app is on the same phone, a `t3code://` link opened from outside may go to either.
- **The name and wording are swapped as Metro bundles**, like the web build:
  `apps/mobile/majordome/metroTransformer.cjs` applies word rules (`majordome/words.cjs`:
  thread to chat, environment to computer, settle to mark as done) to every English sentence of
  two words or more, then the phone's own table, `apps/mobile/majordome/wording.mts`, which
  wins and also lists the single words checked to be display text only, and the name. It does not apply the web tables: they hold
  words like "Thread" that are route names in the phone app, and a swapped route name stopped
  chats from opening (2026-11-23). The shared pure code is `apps/web/vite/majordomeReword.ts`.
  The wording files are part of Metro's cache version, so an edited table is never served stale.
  Tests read the source unswapped.
- **Chats is one list.** A topic sits on its own conversation's row (name, icon, latest
  message) and moves with it, most recent first; topics not opened yet sit above, under no
  heading. Topics marked done fold into "Done topics" at the bottom, with "Bring back". Plain
  chats have no message preview: the server sends none (`latestVisibleMessage` is always null).
- **Chats folds what repeats.** A topic's other chats sit behind a pill on the topic's row, and
  a routine's runs are one row (its latest run, earlier ones behind the pill). A routine can be
  taken out of the list from its long-press menu and brought back from "Hidden routines" at the
  bottom; that choice is kept on the phone only. Which chats are a routine's is worked out as
  on the desktop (`routineThreadKeys`): the chat the routine keeps, plus chats that carry its
  name and were not started by the owner.
- **Links into the app.** The app has its own scheme (`majordome`, `majordome-dev`,
  `majordome-preview`; `majordome/identity.ts`), so a link never opens T3 Code's app on a phone
  with both. `majordome://connections/new?pairingUrl=…` opens the add-a-computer screen filled
  in; the server's Phone page offers it as "In the Majordome app". A server's ordinary pairing
  address under `majord.link` opens the app too (`applinks:*.majord.link`, the file the broker
  serves at the zone's root, and `src/majordome/pairLink.ts`). A link never pairs by itself in
  a released build: the owner presses Connect. Hosted servers are on `fly.dev`, which no app
  can claim, so they only get the app code until they have an address under a domain of ours.
- **Today can show another day** (arrows beside the date); only today's note is kept on the
  phone, and the add box shows on today only, as on the desktop.
- **A literal the code looks things up by must not be swapped.** They are listed in
  `MOBILE_KEPT` (`majordome/wording.mts`), and `majordome/literals.test.ts` fails when a route
  name, a kept text or an unreviewed literal outside a translation call would change.
- **The iPhone icon is the PNG.** Upstream's Icon Composer projects (`assets/*/app-icon.icon`)
  still draw upstream's logo, so the identity step points `ios.icon` at the cloche PNG.
- **Today sits in upstream's one-page Usage tab slot** (`MajordomeTodayScreen`), so the tab key
  is still `usage`. Upstream's tests of the tabs mock `src/majordome/env` with `isMajordome`
  false. The iPhone tab bar's label and icon are in Swift
  (`modules/t3-native-controls/ios/T3SidebarTabBarView.swift`).
- **Building here:** Xcode 26.6 builds it, with CocoaPods from Homebrew.
  `T3_NATIVE_CLIENT_BUILD=local T3_NATIVE_CLIENT_CACHE=off vp run mobile:install ios <simulator>`
  then `vp run dev:client` in `apps/mobile`. A build is about six minutes.
- **Testing writes safely:** `vp run dev` seeds from the real data, so the notes folder it lists
  is the real one. Before adding a line or ticking a to-do from the simulator, remove that
  project from the dev server (`majord project remove --base-dir <worktree>/.t3 --force <id>`)
  and add a throwaway folder holding `.majordome/config.json`. Put that folder outside this
  repository and run `git init` in it. A notes folder inside the worktree has the worktree as its
  git repository, so the server's autosave and backup committed the whole checkout as "Your
  edits", rebased it and pushed it to `main` every few minutes (2026-11-23, five such commits).
- **Signing up with an invite code** (2026-11-23). The route `SettingsHostedSignup`
  (`src/majordome/HostedSignupScreen.tsx`) is reached from "Add a computer" and from Today when
  no computer is added. It posts the code to the broker, asks `/v1/hosted/ready` every 3 seconds
  as the web page does, then connects the phone with the returned link through
  `pairEnvironment`, the call a scanned code uses. A made server is kept in
  `majordome-hosted-signup.json` on the phone until its setup is finished, so a failed
  connection is tried again without the spent code. The rules are in `hostedSignup.logic.ts`.
  - The phone has no sign-in or new-notes screens, so "Finish setting up" makes a one-time
    code (`createPairingCredential`) and opens the server's `/pair#token=…` page in Safari.
    Today's "No notes folder yet" offers the same button for any connected computer.
  - `EXPO_PUBLIC_MAJORDOME_BROKER_URL` at build or Metro start points it at another broker;
    the default is `https://broker.majord.link`.
  - Not run for real: no server was made from the phone, and nothing was looked at in the
    simulator. Unit tests cover the requests, the answers and the steps only. If the broker's
    answer is lost on the way back, the code is spent and the phone does not know the server.
- **Left for the first cut:** a signed build on a real phone and TestFlight (needs an app record
  in App Store Connect and a sign-in there), the widget and share-extension targets (upstream's,
  about coding agents; decide whether to ship them), and the stored title "New thread" on a
  chat not named yet (code compares it, so it needs a display-only mapping like the web's
  `chats.logic.ts`).
