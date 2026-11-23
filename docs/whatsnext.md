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
  `docs/operations/release.md`, drop the note that Intel is off.
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
the provider's cache again: 20,000 to 37,000 tokens a turn, at twice the input price because
they are cached for an hour.

- **Measure first.** The numbers come from `turnTokenUsage` on provider turns in
  `statev2.sqlite` and from Claude Code's transcripts. Not priced: the side requests (key facts,
  "In short", titles), which show up as `otherUsage` with no split between cached and uncached
  tokens, and were as large again as the chats on the server. Run one week on a real API key and
  read the bill, then show cost per run on Overview.
- **Then cut what is loaded.** Find what fills the first request (tool descriptions, the memory
  layers, skills) and why a turn in an open conversation writes so much again; something is
  probably changing early in the prompt and throwing the cache away. The tool-list budget above
  is one known overcount.
- **Then the cache time.** Routines start a fresh session and finish in minutes, so a five-minute
  cache (1.25 times the input price, not 2) should be enough for them.
- **Then the model per job.** Sonnet 5.5 for chat and routines, Haiku 5.5 for sorting the
  reading list and summarising notes. Check each on a copy of real notes before switching.

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

The Hetzner calls (`hetznerApi.ts`) have never run against a real account, and Hetzner rations
new servers, so the first real run decides whether the second host comes before or after.

Then: creating servers behind one interface with a second host, and a one-day trial of sleeping
machines if idle servers have become a real cost.

## Phone

Saving a link to the reading list from a phone waits for the iPhone app's share sheet. See the
M8 note in `docs/decisions.md`.

## Reading list, from the laterlist comparison

Not asked for yet: a calendar of finished items, images in notes, playlist import, an "action"
kind, publishing a list, filing one item under several subjects, and Empty Trash.
