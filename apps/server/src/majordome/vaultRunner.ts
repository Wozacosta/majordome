/**
 * One server runs a vault's routines and inbox watcher: the one whose environment id is in
 * `.majordome/runner`, a one-line text file. A vault without one is claimed by the first server
 * that looks; the claim reaches other machines with the vault's next commit. Moving the runner is
 * explicit. There is no heartbeat and no automatic takeover.
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { VAULT_CONFIG_DIRNAME } from "./vaultConfig.ts";

const RUNNER_FILENAME = "runner";

const runnerPath = (path: Path.Path, vaultRoot: string) =>
  path.join(vaultRoot, VAULT_CONFIG_DIRNAME, RUNNER_FILENAME);

/** The environment id named in the vault's runner file, if any. */
export const readVaultRunner = Effect.fn("majordome.readVaultRunner")(function* (
  vaultRoot: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fileSystem.readFileString(runnerPath(path, vaultRoot)).pipe(Effect.option);
  return Option.filter(
    Option.map(text, (value) => value.trim()),
    (value) => value !== "",
  );
});

export const writeVaultRunner = Effect.fn("majordome.writeVaultRunner")(function* (input: {
  readonly vaultRoot: string;
  readonly environmentId: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.writeFileString(runnerPath(path, input.vaultRoot), `${input.environmentId}\n`);
});

/**
 * True when this server runs the vault's routines. A vault with no runner yet becomes this
 * server's. If the claim cannot be written, nothing runs here: two runners are worse than none.
 */
export const isVaultRunner = Effect.fn("majordome.isVaultRunner")(function* (input: {
  readonly vaultRoot: string;
  readonly environmentId: string;
}) {
  const runner = yield* readVaultRunner(input.vaultRoot);
  if (Option.isSome(runner)) return runner.value === input.environmentId;
  return yield* writeVaultRunner(input).pipe(
    Effect.as(true),
    Effect.catchCause((cause) =>
      Effect.logWarning("Majordome could not claim a vault's routines for this server.", {
        cause,
      }).pipe(Effect.as(false)),
    ),
  );
});
