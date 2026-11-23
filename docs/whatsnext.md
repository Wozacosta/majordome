# What's next

Things found and left for later. Each says what it is, why it waits, and where to start.
Remove an entry when it is done.

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

## Phone

Saving a link to the reading list from a phone waits for the iPhone app's share sheet. See the
M8 note in `docs/decisions.md`.

## Reading list, from the laterlist comparison

Not asked for yet: a calendar of finished items, images in notes, playlist import, an "action"
kind, publishing a list, filing one item under several subjects, and Empty Trash.
