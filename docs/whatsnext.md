# What's next

Things found and left for later. Each says what it is, why it waits, and where to start.
Remove an entry when it is done.

## Before opening to the public

The checklist, made on 2026-11-26. Payment on [majord.me/start](https://majord.me/start) is live
and has one customer, the owner; everything here waits until strangers are told. **Bold** items
block the opening. Tick an item when it is done and remove it once the section is stale.

The opening is the Mac app, the iPhone app, the Android app and hosted servers. Both phone apps
go to their stores for public release (the owner, 2026-11-28; Android was first left for later
on 2026-11-26). Windows and Linux still come after it.

### The owner's to decide or supply

- [ ] **Seller details on the terms page:** the name, sole-trader status, SIRET and a withdrawal
      form are there since 2026-11-27, and the business's Paris address and a Portuguese phone
      number since 2026-11-28. The same two go in Apple's and Google's trader details, which
      is not done yet (see "Both stores" below). Still missing: a consumer mediator. A request was sent on 2026-11-27 to SMP
      (mediateur-consommation-smp.fr, reference #340275, 30 euros for 3 years); once the
      convention is signed and paid, name it on the terms page: Médiation Professionnelle -
      Médiateur de la Consommation - Alteritae, 5 rue Salvaing, 12000 Rodez. The owner lives in
      Portugal and is registering there, so the seller may stop being the French business.
- [ ] **Read `site/terms/index.html` and `site/trust/index.html` line by line.** Both carry
      commitments written by an agent and not reviewed: a 14-day refund, a month refunded after
      a day's outage, 30 days' notice.
- [ ] **Say it is a beta.** No page says so today. Where a person decides: beside the price on
      the landing page and `/start`, and a short section in the terms (one person runs it, it
      may break or change, keep a backup you own, how to leave). It sets expectations; it does
      not remove what a paying French consumer is owed, so the refund and seller items stand.
- [ ] A privacy policy that holds, and data processing agreements with Fly, Cloudflare, Stripe
      and Clerk.
- [ ] An hour with someone who does this for French small businesses: a French version, a pay
      button that states the obligation to pay, and for the accountant the VAT mention and the
      EU cross-border threshold.

### Payment

- [ ] **One real purchase by someone else** on `/start`, the card typed into Stripe's page. That
      step has never been run.
- [ ] **Managed Payments, seen working.** Switched on in the broker on 2026-11-26
      (`STRIPE_MANAGED_PAYMENTS`), once Stripe marked the account "Ready to use": Stripe sells
      in its own name and handles the tax. No sale has gone through it yet. To check on the
      first one: the checkout page, the receipt naming Stripe as the seller, and that the
      refund button still gives the money back, since Stripe also takes refund requests itself.
- [ ] The margin, and whether 1 GB holds. Since 2026-11-26 a new server has 1 GB of memory
      with 1 GB of swap, in Amsterdam, and the price is 14 euros (it was 12 on a 2 GB server in
      Paris, about $16 a month at Fly's prices). At list prices the smaller server is about
      7.60 euros, which leaves about 2 euros after Stripe's fees and VAT. Measured that day on
      the owner's 2 GB server: about 610 MB at rest, 934 MB with a chat and one page open in
      the browser, 1,043 MB at the week's highest. Nobody has yet used a 1 GB server for real:
      if chats get slow or the server restarts, set `memoryMb` back up in
      `infra/broker/src/worker.ts` (1.5 GB needs about 18 euros). Check the cost against one
      Fly invoice. Stopping idle servers would bring it to a few dollars; set aside for now.
- [ ] `MAX_HOSTED_SERVERS` is 30 (it was 10 until 2026-11-28). It counts servers that are on; raising it raises the most the
      Fly bill can reach. The 31st buyer is turned away before paying: `/start` hides the offer
      and says "Majordome is not taking new servers right now. Try again later.", the phone
      apps say the same and that nothing was bought, and an invite code is refused the same
      way. Nobody is told when a place frees up, and a store reviewer or tester who subscribes
      takes a place too. Raise it before the stores open, or decide what the 31st should see.
- [ ] A new email is a new free trial (`trialFor` in `infra/broker/src/billing.ts`). Decide
      whether that is acceptable for now.

### Both stores

The checklist for submitting the two phone apps, made on 2026-11-28. Nothing has been sent to
either store. Details of each app are in "The iPhone app" and "The Android app" below.

- [x] **The identifiers are permanent once published:** the iPhone bundle identifier
      `io.github.wozacosta.majordome.ios` and the Android package
      `io.github.wozacosta.majordome` (`apps/mobile/majordome/identity.ts`). They carry a
      GitHub user name. Changing either later means a new listing and everyone reinstalling.
      Kept as they are (2026-11-28).
- [ ] **EU trader details in both consoles:** the address and phone number that are on the
      terms page, shown on each listing. The owner's to type in.
- [ ] **A demo account and a sample server for the reviewers,** with Claude signed in and
      sample notes, never the owner's. It must stay on for the whole review, and both stores
      ask for the sign-in.
- [ ] **Store listings:** name, description, screenshots. The App Store name is "Majordome:
      Your Second Brain" (`docs/operations/majordome-testflight.md`). Google also wants a
      feature graphic. None are in the repository.
- [ ] Privacy answers in both consoles, matching `site/privacy/index.html`: Apple's privacy
      labels (filled in on the web only) and Google's data safety form. Both ask for the
      privacy address, `https://majord.me/privacy`.
- [x] Sign in with Apple beside Google (Apple's rule 4.8). On in Clerk's production instance
      since 2026-11-28: Services ID `io.github.wozacosta.majordome.signin`, key `9BYT7ULKT8`,
      the iPhone app registered under Native applications. No code: Clerk's sign-in screen shows
      it by itself. Not yet signed in with a real Apple account by anyone.
- [ ] The code on the Welcome page's Phone step opens majord.me/open. Point it at the two
      listings once they exist (`apps/web/vite/wording/links.ts`).
- [ ] The share extension is upstream's: it puts what you share from another app into a new
      chat. Keep it or drop it. (The widgets, about coding agents, are out of the build.)

Checked on 2026-11-28 and fine: the permission prompts say Majordome on both phones (the
identity step swaps the name through the whole config, plugin texts included), an account can
be deleted in the app and on `majord.me/server`, and a chat not named yet shows "New chat".

### The App Store

- [ ] **The Paid Apps agreement.** The W-8BEN form waits for the owner's signature. Until it is
      active a subscription cannot be sold to the public.
- [ ] **The purchase, checked in App Store Connect.** Subscribing on a TestFlight build makes
      the server since 0.10.78, so the subscription and the In-App Purchase key exist. Not
      checked from here: the price matching the web's with a one-week free offer, the billing
      grace period, the notice address (`infra/broker/README.md`, "Apple, once"). In the
      broker, a purchase with no account token is still dropped (`appleFacts` in
      `infra/broker/src/apple.ts`). No purchase has been charged for real.
- [ ] **The subscription's own review:** a screenshot of the purchase screen and a review note,
      sent with the first build that sells it.
- [ ] **Review notes, rewritten.** `.plans/app-store-review-notes.md` (2026-11-24, not in git)
      says the app has no purchases, which is no longer true. The new notes say how to reach
      the purchase, give the demo account, and explain two things a reviewer asks about: the
      background audio mode (upstream's config has it for picture in picture; check whether
      the voice uses it, and drop it if nothing in Majordome does) and `NSAllowsArbitraryLoads`
      (the app talks to the user's own server on their home network, which has no certificate).
- [ ] **iPad.** The build supports iPad (`supportsTablet` in `apps/mobile/app.config.ts`), so
      Apple asks for iPad screenshots and reviews it there. Look at it on an iPad simulator
      first, or turn iPad off in `apps/mobile/majordome/identity.ts`.
- [ ] Test purchases count in the broker (`APPLE_ALLOW_SANDBOX` is `"1"` in
      `infra/broker/wrangler.deploy.jsonc`): the reviewer's free purchase makes a real server
      and takes one of the 30 places. It has to stay on through review.
- [ ] A TestFlight link for people outside the team goes through Beta App Review first.
- [ ] Someone other than the owner signs up from the iPhone. The owner has, on TestFlight.

### Google Play

- [ ] **Start the closed test first: it is the longest wait.** A new personal developer account
      (25 dollars, identity check) needs a closed test with 12 testers for 14 days in a row
      before the app can be public. Find the 12 people now.
- [ ] **Decide how the Play build sells a server.** The Android app opens Stripe's checkout in
      a browser (`SOLD_ON_WEB` in `apps/mobile/src/majordome/hostedSignup.ts`). Play normally
      wants a subscription used inside the app to go through Play Billing. Either a Play build
      with no buy button and no link to the price, or build Play Billing (a third way of paying
      in the broker, beside Stripe and Apple). The owner's decision, not made yet. The APK
      from GitHub can keep selling on the web either way.
- [ ] **An app bundle, not an APK.** Play takes an AAB and signs what it delivers itself (Play
      App Signing). `scripts/majordome-android-apk.sh` only runs `assembleRelease`; it needs a
      `bundleRelease` path. When enrolling, give Play the existing key
      (`~/.majordome/android/release.jks`) as the app's signing key; with a key Play makes
      itself, a phone that has the APK must remove it before installing from Play.
- [ ] Play Console forms: content rating, target audience, the data safety form, and the web
      address for deleting an account (`https://majord.me/server` has the button; Google wants
      a page that says so plainly).
- [ ] Read Play's AI-generated content policy: it asks apps that generate content to let people
      report offensive output from inside the app. Whether it applies to an app whose
      assistant runs on the user's own server with their own Claude account is not settled;
      Majordome has no such button.

### The landing page and the docs

- [ ] **The Intel Mac build** (below).
- [ ] `docs/user/` beyond `install.md` still describes T3 Code (see "Still pointing at T3 Code").

### Running it

- [ ] **Alerts.** The broker can post a line when the hourly pass fails, and posts nowhere: the
      `ALERT_URL` secret is not set (`infra/broker/README.md`, "Paid servers"). A private ntfy
      topic is the least work. A failed settle right after a Stripe notice is only logged; the
      hourly pass is what reports it.
- [ ] **A support address that is read, and a way to report a bug.** The triage tool is hidden.
- [ ] Removing a server and restoring a backup are by hand. Say how fast either is promised.
- [ ] The nightly update does not wait for a run in progress to finish.
- [ ] Something that checks the broker and `majord.me` are up.

### A stranger's first run

- [ ] **Watch one person who is not the owner** go from the landing page to a first chat, on a
      clean Mac and on a hosted server. Everything so far was tested by its author.
- [ ] The hidden settings pages (Source control, Worktrees, Devices, Diffs) may still open by
      address.
- [ ] T3 Code's name is left in the SSH failure message and the triage prompt.

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

- **`docs/user/`.** `install.md` is rewritten and Majordome's own pages are new. `updating.md`,
  `faq.md`, `triage.md`, `remote-access.md` and others still describe T3 Code and its `t3`
  command.
- **SSH computers.** The option is hidden when adding a computer. The code behind it still
  downloads a command-line build Majordome does not publish, and its failure message names
  T3 Code's install script (`packages/ssh/src/tunnel.ts`).
- **The triage tool.** Hidden on the start-up error screen and answered by a message in
  `majord triage`. Its prompt and service still name T3 Code's repository
  (`apps/server/src/triage/`).
- **The hosted app's empty state** (`InstallT3Commands.tsx`) shows T3 Code's install commands.
  Majordome has no hosted app, so nobody sees it today.
- **Coding guidance in the chat instructions.** `orchestrationInstructions.ts`
  (`packages/provider-core/src/server/`) still explains
  worktree chats and says "Ordinary coding tasks need no T3 tools". About 5 KB per chat; the
  file differs from upstream by one line, so trimming it costs merge conflicts.

### Not checked

- **Model-behaviour evals** for the removed instruction text were not run: the repo has no API
  keys. See `evals/README.md`.
- **A git fetch every 30 seconds on the notes folder.** Read from the code
  (`VcsStatusBroadcaster.ts`), but 70 minutes of the live server's log showed one fetch. Left
  alone; look again if the backup remote shows heavy traffic.
- **Hidden settings pages** (Source control, Worktrees, Devices, Diffs, Snap shot) are gone from
  the menu and search but still open by address: their routes
  (`apps/web/src/routes/_chat.settings.*.tsx`) have no redirect, unlike Scheduled tasks, which
  goes to Routines.
- **The tool-list budget** in `agentContextBudget.json` counts every registered tool, including
  the hidden coding ones, so it overstates what a chat is told by about 13 KB.

## What the AI costs: measure, then improve

AI included in a hosted server's price (about $20 a month) was set aside on 2026-11-23, not
dropped (see `docs/decisions.md`): what a chat message and a routine run cost decides whether
that price would hold. Until then the saving applies to anyone on an API key, and to how fast a
customer's own plan runs out.

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
- **What filled the first request before the cuts below, about 45,000 to 55,000 tokens.**
  Roughly 65% was Claude Code's own tools and listings, including its Artifact tools (8,000 to
  13,000 tokens). About 16% on the owner's Mac was his personal Claude plugins and settings,
  loaded because the session read `~/.claude`. About 18% was Majordome's own text.
- **"Other requests as large again as the chats" was earlier turns counted again**, fixed on
  2026-11-24: Claude Code restores a resumed conversation's totals into its ledger, so the
  first turn after a restart was charged with every turn before it. Real side requests are
  about 4% of the chats.
- **The small jobs already run on Haiku** (key facts, "In short", titles), through the
  provider's fallback. Only chat and routines are on Opus.

Cut on 2026-11-24 (`apps/server/src/majordome/claudeSessionCuts.ts`), measured on a first
request of 43,755 tokens (Haiku, a small notes folder, the owner's Mac): the Artifact tools,
12,346 tokens, and the owner's personal Claude Code settings, 9,899. Turning off only his two
plugins saved 1,601, which is why the whole "user" source is left out. Routines keep their
cache five minutes, not an hour.

Still proposals, each the owner's to decide:

1. **Sonnet 5.5 for chat and routines by default**, Opus on request. About half the cost. The
   owner chose to stay on Opus for now (2026-11-24).
2. **Name the built-in tools a session may use** instead of taking Claude Code's whole list.
   About 5,300 tokens.
3. **Run one week on a real API key** and check these figures against the bill, then show cost
   per run on Overview.

## Phone with your own server, and no computer

Checked on 2026-11-27 by reading the code and the guide, not by running it: the path works but
assumes a computer. `deploy/install.sh` makes the server reachable over Tailscale only, so the
phone needs the Tailscale app; the public address that avoids it is switched on from the desktop
app. The script's last line and the guide talk about "your computer" and moving notes. The owner's
call that day: document it and leave it, since people who rent a server mostly have a computer.
If it is ever made first-class: let the install command turn on the public address, and give it
wording for a phone.

## Hosted Majordome: where the servers come from

Built and on sale: a server on Fly.io, made by the address broker for an invite code or a
subscription (Stripe on `majord.me/start`, Apple in the iPhone app), owned by a Majordome
account. How it works is in `docs/decisions.md` and `infra/broker/README.md`; what
is left before strangers are told is in "Before opening to the public" above. Kept here: what
was learned on the way, so it is not looked up twice, and what is open beyond the opening.

- **Size.** The owner's server used about 425 MB of memory at rest and 1.5 GB of disk on
  2026-11-23, and was listening 3 seconds after it started. New servers have 1 GB of memory
  with 1 GB of swap since 2026-11-26; the measurements behind that are under "Payment" above.
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
  transfer is the AI: notes go to the model provider. The policy and the agreements still to
  sign are in "Before opening to the public" above.

**Decided on 2026-11-23: start the way OpenBot does.** The customer signs their own Claude plan
in on the hosted server and pays for the server only. It needs no credential of ours, no cap
and no metering, so the capped credential per customer below is set aside until AI is included
in the price. The risk is in the quotes that follow and was accepted for a demo and the first
few users, then on 2026-11-27 for the public opening too: OpenBot does the same in the open.
The customer is shown no notice about it (the owner, 2026-11-28); an API key of their own stays
possible. The price is the server plus a margin.

**Anthropic's terms, read before that decision.** Read on 2026-11-23 at
https://code.claude.com/docs/en/legal-and-compliance (quotes are theirs):

- Running Claude Code in a product, "e.g. in hosted sandboxes or other agent infrastructure",
  "requires agreeing to our Commercial Terms of Service", and the program must be unmodified.
- "Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf.
  Each end user must authenticate with their own Anthropic API key, Claude subscription plan
  credentials, or 3P inference provider credential". The shape set aside (Majordome holds the
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

Set aside with AI in the price, and needed if it comes back:

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

A server by hand, for a test. These commands worked on 2026-11-23 with the released image
(0.10.26), 2 shared CPUs and 2 GB in Paris; what the broker makes today is in
`infra/broker/src/fly.ts`:

```sh
fly apps create --generate-name --org personal
fly volumes create data --size 3 --region cdg --app <app> --yes
fly machine run ghcr.io/wozacosta/majordome:latest --app <app> --region cdg \
  --vm-memory 2048 --vm-cpus 2 --vm-cpu-kind shared --volume data:/data \
  --port 443:3773/tcp:http:tls --port 80:3773/tcp:http \
  --env MAJORDOME_PUBLIC_URL=https://<app>.fly.dev --restart always --detach
fly ips allocate-v4 --shared --app <app> && fly ips allocate-v6 --app <app>
```

Seen in that run:

- It was listening about 4 seconds after the machine started, with no start-up script, no
  Tailscale and no tunnel. The volume was writable by the image's `node` user with nothing
  done. 605 MB of 1,970 MB in use at rest. Claude's sign-in is kept on the volume
  (`/data/.claude`).
- **A Fly account without a card stops every machine after 5 minutes** ("Trial machine
  stopping"), and starts it again on the next request. Pay As You Go lifted it without
  recreating the machine.
- **Stop and wake works.** After such a stop, a request started the machine in under a second
  and Majordome was listening 9 seconds later. The visitor who wakes it gets a 503 page from
  Fly's proxy in between, which is what a "waking your server" screen has to cover. Data and
  the Claude sign-in survived every stop.
- **Each start prints a new pairing link**; a link made with `majord pair` kept working across
  a restart.
- The test server that is kept is the app `patient-petal-578`, on Pay As You Go.

Still open, beyond the checklist above:

- **The start-up log warns that the address "uses plain HTTP"** although Fly serves it over
  HTTPS (`formatHeadlessServeOutput` in `apps/server/src/startupAccess.ts`).
- **A backup the customer owns** (Google Drive, GitHub) is still theirs to turn on. Fly's daily
  copies are the only layer that is on by itself.
- **The address** is `majordome-<10 characters>.fly.dev`, which names the host. A name under a
  domain of ours needs a certificate per server on Fly. The owner has `majord.me` (the landing
  page today) and `majord.link` (the tunnels' addresses); a subdomain of `majord.me` is the
  natural home, since `majord.link` hands its names to tunnels.
- **Moving notes from the Mac app** ("Move my notes to your Majordome server"). Not tried for
  real: moving routines, which needs Claude signed in on the server. The server must be added
  to the app first, and must not have had "Start new notes" pressed, or it ends up with two
  notes folders.
- **A server made with an invite is removed by hand** (`infra/broker/README.md`). A paid one is
  deleted by its owner, or 30 days after it stops being paid for.
- **The built-in browser.** On Fly, `majord browser setup` reports that Chrome's sandbox is
  allowed, and the log has no "this host blocks the sandbox" warning, which the OVH server
  prints. No one has opened a tab from a phone on a chat that runs there yet.
- **Anthropic's answer.** None is recorded. The owner accepted the risk for the opening on
  2026-11-27 (above), and the ways out listed under its terms stand.

Later, in this order when each is needed: sleeping (the service stops and wakes machines, as
OpenBot's does), a second host behind one interface, a pool of ready servers.

## Trust and transparency: a hosted server is the customer's

The question a customer asks: how do I know the person running my server is not reading it or
changing it? Today the honest answer is that nothing technical stops it. The owner of the Fly
organisation can open a shell on any server, read its disk and its daily copies, and the nightly
update runs whatever image the latest release names. The customer's Claude sign-in sits on that
disk too. What exists already: the code is public, the broker holds no notes, and anyone can
leave with **Settings > Back up my brain** and run Majordome on their own machine.

One thing does pass through the broker since 2026-11-28: a notification for a phone app. Its
title and its one line (a chat's name, the first line of "Start my day", what the assistant was
asked to say) go from the server to the broker to Apple or Google. The broker keeps none of it,
but it sees it, and so does whoever runs it. The user guide says so
(`docs/user/phone-and-notifications.md`); the trust page on the site does not yet.

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

## Sharing a chat with a guest

Not asked for yet, noted on 2026-11-26 when the switch was hidden from Labs. T3 Code lets you
hand someone a link to one chat: they watch it live in a browser and send messages you approve.
The switch is hidden in Majordome (`guest-links` in `MAJORDOME_HIDDEN_SETTING_IDS`) because the
link only works through T3 Connect.

It looks doable without T3 Connect. Everything except the address is already in the server and
does not depend on T3: the link tokens, the approval of guest messages and the guest's page
(`apps/server/src/guest/`). The one tie is in `GuestShareService.ts`, which takes the public
hostname the link is made for from the tunnel connector (`inspectConnector`) and refuses when
there is none. Read on 2026-11-28, not run: the `majord.link` phone address runs on that same
connector (`AnywhereAddress.ts`), so a computer with its phone address on may already pass
that check. A hosted server has no connector, only its own address.

To do:

- Turn the switch on with a phone address on and see whether a link is made and opens. Then
  give `GuestShareService` a hosted server's address too, and check links close when the
  address is turned off, as they do today when Connect is unlinked.
- Decide what a guest may reach on that address. Today the phone address serves the whole app
  behind pairing; a guest link is a second, unpaired way in, so read `SECURITY.md` and
  `docs/internals/04_environment-auth.md` first.
- Reword the switch and the "Share with guest" entry in a chat, which name T3 Connect.
- A computer reached only through Tailscale has no public address, so no guest link.

## Reading list, from the laterlist comparison

Not asked for yet: a calendar of finished items, images in notes, playlist import, an "action"
kind, publishing a list, filing one item under several subjects, and Empty Trash.

## What the phone lacks beside the computer

From a review of 2026-11-28, made by reading the code after the phone was rebuilt around the
list of topics (0.10.90). Nothing here was tried on a device. The phone uses 23 of the about 90
calls in `packages/client-runtime/src/state/majordome.ts` that the computer uses, so most
entries need a screen and no server work. Paths are under `apps/mobile/src` unless said.

Broken, to fix first:

- [ ] **Allowing a private document or a settings change.** The phone draws the generic secret
      card (a "Value" box, "Save securely") where the computer has a yes/no card, so only
      declining works. It also stops the Set-up chat from changing anything. Start at
      `features/threads/ThreadFeed.tsx` (where requests reach `SecretRequestCard`) and the
      computer's `ApprovalRequestCard.tsx`; the calls are `approval`, `answerApproval`,
      `privateDocumentRequest` and `answerPrivateDocumentRequest`.
- [ ] **One-tap replies.** An answer ends with the raw line "Replies: Yes | No" because nothing
      on the phone parses it. Move the computer's `QuickReplies.logic.ts` into shared code.
- [ ] **Links from the assistant to a Settings page.** `majordome/setupChat.logic.ts` knows only
      the Claude plan, look and language, and voice; a link to Passwords and keys, Archived
      chats, Your account or Computers says the page is on the computer.

Missing, most useful first:

- [x] **Notifications** (2026-11-28, code only). The phone registers its device token with each
      computer, the computer sends through the address broker, and Settings on the phone has a
      Notifications page (`majordome/phonePush.ts`, `PhonePushRelay.ts`, `infra/broker/src/push.ts`).
      Nothing arrives until the owner does the steps in `docs/operations/majordome-push.md`:
      Apple's push key and the Firebase project, as Worker secrets, then a deploy.
- [ ] **Notifications, what remains.** A first run on a real iPhone and a real Android phone:
      no notification has been delivered yet, and whether a Cloudflare Worker reaches Apple's
      push service (HTTP/2 only) is the first thing to check. The four kinds only; the phone
      has no per-kind switches. A notification that is not about a chat (the test, "Routines
      can't run") opens the app on its list, not a page of its own. No badge count.
- [ ] **What it did, with Undo this** (`vaultHistory`, `vaultChanges`, `undoVaultRun`).
- [ ] **To-dos from every note.** Today shows only the day's own boxes (`todos`,
      `setTodoDone`, `addTodo`).
- [ ] **Notes: browse, read, edit, search** (`notesSearch`, `saveNote`). Home's search matches
      chat and topic titles only.
- [ ] **Reading list**, and the share sheet saving to it rather than opening a chat.
- [ ] **Skills** waiting to be kept (`skills`, `keepSkill`, `removeSkill`).
- [ ] **Backup:** its state and Back up now (`backupStatus`).
- [ ] **Phones that can open Majordome**, to remove a lost one (`authEnvironment.accessChanges`,
      `revokeClient`).
- [x] **Camera:** "Take a photo" in a chat's "+" menu, and a camera button on home's box that
      opens a new chat holding the photo.
- [ ] **The photo library, files and the microphone on home's box** (`majordome/homeAsk.tsx`).
- [ ] **Topics:** make a custom one, rename, reorder, delete, turn a chat into one.
- [ ] **Connectors per machine**, with a link to claude.ai where they are added (`connectors`).
      It fits under "Claude plan".
- [ ] **What Quick, Everyday and Powerful mean**, and the default model for new chats.
- [ ] **Private documents page:** add, remove, who opened what.
- [ ] **Usage.** The screen exists (`SettingsUsage`) but nothing leads to it without a
      keyboard, and `docs/user/usage.md` names a tab the phone no longer has. By routine and by
      topic is `usageByUse`.
- [ ] **Routines:** ready-made ones, limits, run history, the week calendar.
- [ ] **Adding this computer to the account**, and the anywhere address, from the phone.
- [ ] What's new, help and "Report a problem".

Coding leftovers a phone owner can still reach:

- [ ] "Which AI answers" lists the whole model catalogue under the three levels
      (`ThreadSettingsSheet.tsx`); the computer shows the levels alone.
- [ ] Step details show shell commands and exit codes once "Answers only" is switched off.
- [ ] Links such as `majordome://pull-requests/…`, `…/terminal`, `settings/worktrees` and
      `settings/labs` still open: `lib/appLinking.ts` has no Majordome filter.
- [ ] With a hardware keyboard, shortcuts open Terminal, Review and the Files tree, and the
      command palette offers "Triage an issue".
- [ ] An untitled recent chat is "Thread" in the app icon's menu (`appShortcuts.ts`).
- [ ] Settings pages no screen links to any more (`SettingsThreads`, `SettingsLabs`,
      `SettingsWorktrees`, `SettingsNavigation` and others in `Stack.tsx`): remove them from
      Majordome's routes or leave them to upstream, but decide.

Left unchecked when the phone was rebuilt (0.10.90):

- [ ] Tablets and foldables. The side list got the Today strip; nobody looked at one.
- [ ] Voice mode and the "Talk" shortcut after the tab bar went.
- [ ] The Set-up chat with a real assistant; it was only tried with the replay one.
- [ ] A scenario for the new phone screens. The logic has unit tests only.
- [ ] On the computer, the Set-up chat shows among recent chats.

Drawn and kept for later: one permanent "Majordome" conversation at the top of the list that
files what is said into topics, to compare against the plain list; and the day page as a
"Brief" of what the assistant did and what waits for a yes, which needs one new call listing
everything that waits.

## The Android app

Started 2026-11-27. It is the iPhone app's code; `apps/mobile/majordome/identity.ts` gives it
its package (`io.github.wozacosta.majordome`), icons and launch screen. How to build it and what
it lacks are in `docs/operations/majordome-android.md`. It is on the owner's own phone since
2026-11-27, and the voice works there since 0.10.87.

- [ ] **Google Play.** Decided on 2026-11-28: it goes to the store. The steps are under
      "Google Play" in "Before opening to the public". Until then the APK is built on the
      owner's Mac and can be attached to a GitHub Release (`vp run mobile:apk --release v1.2.3`).
- [ ] **Back up the signing key** (`~/.majordome/android/release.jks` and its password in
      `~/.majordome/android.env`). Without it no update installs over the app.
- [ ] **Buy a server from the Android app, for real.** The app opens the website's Stripe
      checkout and makes the server when the payment is in (2026-11-27). Only the logic is
      tested: no payment has gone through it, and whether Google Pay shows depends on the
      Stripe account's payment methods.
- [ ] `majord.link` addresses opening in the app. It needs the broker to serve
      `/.well-known/assetlinks.json` with the signing key's SHA-256 (Play's own key once the
      app is there) and an intent filter in `apps/mobile/majordome/identity.ts`.
- [ ] Notifications: built (2026-11-28) and off until the app is made with the Firebase
      project's file, named by `ANDROID_GOOGLE_SERVICES_FILE` in `~/.majordome/android.env`.
      Without it the page says "Your computer can't send them yet". Steps in
      `docs/operations/majordome-push.md`.
- A symbol that exists only on the iPhone draws nothing on Android. Majordome's own screens
  use the shared `SymbolView`, or `TopicSymbolView` for topic icons, which has an Android list
  to extend when a topic gets a new icon (`src/majordome/TopicSymbol.android.tsx`).

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
- **No tab bar.** With `isMajordome` true the chat list is the only root and no bar is drawn on
  either platform; Today is the stack route `Today` (`majordome/homeNavigation.ts`) and Settings
  is pushed over the list. Upstream's tests of the tabs mock `src/majordome/env` with
  `isMajordome` false. Upstream's tab code, Swift and Kotlin included, is left in place.
- **Building here:** Xcode 27.2 builds it, with CocoaPods from Homebrew.
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
  - Setup ends on the phone (`src/majordome/FinishSetup.tsx`): Claude's sign-in opens in
    the phone's browser and its code is pasted back, and "Start new notes" makes the folder.
    Today shows the same for any connected computer with no notes folder, and the sign-in
    card alone when Claude is signed out later. Restoring a backup or using notes already
    there still opens the server's `/pair#token=…` page with a one-time code.
  - `EXPO_PUBLIC_MAJORDOME_BROKER_URL` at build or Metro start points it at another broker;
    the default is `https://broker.majord.link`.
  - Subscribing from the phone has been run by the owner on TestFlight (0.10.78). Whether the
    invite-code path was ever run from a phone is not recorded. If the broker's answer is lost
    on the way back, the code is spent and the phone does not know the server.
- **TestFlight builds** come from `vp run mobile:testflight`
  (`docs/operations/majordome-testflight.md`). What is left before the App Store is under "Both
  stores" and "The App Store" in "Before opening to the public".
