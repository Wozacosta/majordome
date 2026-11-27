// `test` for first-run tests: e2e's web test plus `firstRun`, which opens the app as its new
// owner and reads what the machine was asked to open in a browser.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { test as base } from "@e2e-dev/web";
import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { FIRST_RUN_HOME } from "../first-run.e2e.config.ts";

const readHomeFile = Effect.fn("firstRun.readHomeFile")(function* (name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs.readFileString(path.join(FIRST_RUN_HOME, name));
}, Effect.provide(NodeServices.layer));

export interface FirstRun {
  /** Opens the app, paired, on whatever a new owner sees first. */
  readonly open: () => Promise<void>;
  /** The addresses this machine was asked to open in a browser, oldest first. */
  readonly openedInBrowser: () => Promise<ReadonlyArray<string>>;
  /** A note of the notes folder the owner started, by its path inside it. */
  readonly note: (name: string) => Promise<string>;
}

export const test = base.extend<{ firstRun: FirstRun }>({
  firstRun: async ({ app, browser }, use) => {
    await use({
      open: async () => {
        await app.open(await Effect.runPromise(readHomeFile("pairing-path")));
        await expect(browser).not.toHaveURL(/\/pair(?:[?#]|$)/, { timeout: 60_000 });
      },
      note: (name) => Effect.runPromise(readHomeFile(`owner/Majordome/${name}`)),
      openedInBrowser: () =>
        Effect.runPromise(
          readHomeFile("opened.txt").pipe(
            Effect.map((text) => text.split("\n").filter((line) => line !== "")),
            Effect.orElseSucceed(() => []),
          ),
        ),
    });
  },
});
