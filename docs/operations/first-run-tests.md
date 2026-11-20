# First-run tests

Majordome only. These are [e2e](https://e2e.com/docs) tests of what a new owner meets: the real
dev stack on an empty T3 home, with an empty `HOME`, no Claude on `PATH`, and no replay agent
standing in for it. They live in [`scripts/first-run`](../../scripts/first-run) and have their own
config, [`first-run.e2e.config.ts`](../../scripts/first-run.e2e.config.ts), because
[scenarios](scenarios.md) turn every real provider off.

```sh
vp run first-run first-run/claude-installs-and-sign-in-starts.e2e.ts
CLAUDE_CODE_OAUTH_TOKEN=... vp run first-run first-run/signed-in-claude-answers.e2e.ts
```

Run one file per run: the app command recreates the home, and each test starts from nothing.
Results land in `scripts/.e2e-first-run`.

- **Install and sign-in start.** Runs Claude's real installer from the welcome page, then starts
  sign-in. The sign-in page is Anthropic's and no test drives it: the run sets `BROWSER` to a shim
  that records the address, and the test stops once Claude has asked for its authorize page.
- **First answer.** Needs a token from `claude setup-token`, which the server accepts in place of
  the browser sign-in. It asks the cheapest Claude model one question on that account's plan.

[`first-run.yml`](../../.github/workflows/first-run.yml) runs the first on every push to `main`,
on Linux and macOS. It runs the second nightly and before a release, when the
`CLAUDE_CODE_OAUTH_TOKEN` repository secret is set, and warns when it is not.
[`majordome-release.yml`](../../.github/workflows/majordome-release.yml) does not publish a
version whose first run fails. The first-answer run uploads only its summary: the repository is
public and its captures show a real account.
