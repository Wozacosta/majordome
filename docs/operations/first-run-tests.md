# First-run tests

Majordome only. These are [e2e](https://e2e.com/docs) tests of what a new owner meets: the real
dev stack on an empty T3 home, with an empty `HOME`, no Claude on `PATH`, and no replay agent
standing in for it. They live in [`scripts/first-run`](../../scripts/first-run) and have their own
config, [`first-run.e2e.config.ts`](../../scripts/first-run.e2e.config.ts), because
[scenarios](scenarios.md) turn every real provider off.

```sh
vp run first-run first-run/claude-installs-and-sign-in-starts.e2e.ts
vp run first-run first-run/chatgpt-sign-in-starts.e2e.ts
vp run first-run first-run/gemini-installs-and-sign-in-starts.e2e.ts
vp run first-run first-run/owner-says-who-they-are.e2e.ts
FIRST_RUN_REPLAY=1 vp run first-run first-run/first-ask-starts-a-chat.e2e.ts
FIRST_RUN_REPLAY=1 vp run first-run first-run/today-offers-first-topics.e2e.ts
CLAUDE_CODE_OAUTH_TOKEN=... vp run first-run first-run/signed-in-claude-answers.e2e.ts
```

To click through a new owner's copy yourself, `vp run new-owner` starts the same stack and opens
it in your browser; Ctrl-C ends it. Add `--replay` (`vp run new-owner --replay`) for a ready
assistant. It uses its own home under `$TMPDIR` and never touches the installed app.

In the Mac app and the browser, hold the version in Settings, About, for the Testing page.
**Start over as new** signs out and forgets every other computer. In the Mac app, **Open as a
new owner** starts a second app whose `HOME` is an empty folder under `$TMPDIR`
(`majordome-new-owner-app`), so its notes, its account and the assistant's sign-in all start from
nothing; the folder is emptied each time, unless a copy is still open. The copy carries
`MAJORDOME_NEW_OWNER_COPY`, which keeps it from the background service: launchd knows one
service per user, whatever `HOME` says. A link that returns to the app, such as Google's
sign-in, goes to whichever Majordome macOS picks, so sign in to the copy with an email code. A
development build (`vp run dev:desktop`) cannot open a copy.

On the phone, hold the version in Settings, About, for the Testing screen: **Start over as new**
signs out and forgets every computer. A build with the development account key also lists test
accounts to sign in as with one tap (`+clerk_test` addresses, which production does not have):
a new one each time, and three kept ones that stay as you left them.

Run one file per run: the app command recreates the home, and each test starts from nothing.
Results land in `scripts/.e2e-first-run`.

- **Install and sign-in start.** Runs Claude's real installer from the welcome page, then starts
  sign-in. The sign-in page is Anthropic's and no test drives it: the run sets `BROWSER` to a shim
  that records the address, and the test stops once Claude has asked for its authorize page.
- **Who the owner is.** Types a name and a first ask on the welcome page with no assistant
  installed, then checks the name is in the new folder's `me.md` and the ask waits in Today's box.
- **First chat.** The same with `FIRST_RUN_REPLAY=1`, which keeps the free replay assistant ready
  the way Claude is once signed in: the ask is sent as the first chat.
- **First answer.** Needs a token from `claude setup-token`, which the server accepts in place of
  the browser sign-in. It asks the cheapest Claude model one question on that account's plan.

[`first-run.yml`](../../.github/workflows/first-run.yml) runs the first on every push to `main`,
on Linux and macOS. It runs the second nightly and before a release, when the
`CLAUDE_CODE_OAUTH_TOKEN` repository secret is set, and warns when it is not.
[`majordome-release.yml`](../../.github/workflows/majordome-release.yml) does not publish a
version whose first run fails. The first-answer run uploads only its summary: the repository is
public and its captures show a real account.
