/**
 * Which brain a vault is, across servers: the root commit of its history. Every server's copy of a
 * brain shares it, with or without a remote, and two brains never do, since each vault's history
 * starts with its own first commit. Following first parents keeps it stable when an unrelated
 * history is merged in later.
 */

import * as Effect from "effect/Effect";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/** Null while the vault has no commit yet. */
export const readVaultBrainId = Effect.fn("majordome.readVaultBrainId")(function* (cwd: string) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const result = yield* git.execute({
    operation: "majordome.vaultBrainId",
    cwd,
    args: ["rev-list", "--first-parent", "--max-parents=0", "HEAD"],
    allowNonZeroExit: true,
  });
  if (result.exitCode !== 0) return null;
  const root = result.stdout.trim().split("\n").at(-1)?.trim() ?? "";
  return root === "" ? null : root;
});

/** `readVaultBrainId`, read once per vault: a root commit never changes. */
export function makeVaultBrainIds() {
  const known = new Map<string, string>();
  return (cwd: string) => {
    const brainId = known.get(cwd);
    if (brainId !== undefined) return Effect.succeed(brainId);
    return readVaultBrainId(cwd).pipe(
      Effect.tap((found) =>
        Effect.sync(() => {
          if (found !== null) known.set(cwd, found);
        }),
      ),
      Effect.orElseSucceed(() => null),
    );
  };
}
