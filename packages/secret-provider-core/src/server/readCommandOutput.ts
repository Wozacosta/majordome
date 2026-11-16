import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChildProcess } from "effect/process";

/**
 * Runs a program with an argument array and no shell, so nothing in `args` is ever interpreted.
 * Standard output on success; `undefined` on a non-zero exit, a timeout, or a program that cannot
 * start. Only the exit code is logged: output and error text can hold the secret.
 */
export const readCommandOutput = Effect.fn("SecretProvider.readCommandOutput")(function* (input: {
  readonly source: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly timeout: Duration.Input;
}) {
  const outcome = yield* spawnAndCollect(
    input.command,
    ChildProcess.make(input.command, input.args, { shell: false, stdin: "ignore" }),
  ).pipe(
    Effect.timeoutOption(input.timeout),
    Effect.catch((error) =>
      Effect.logWarning("Could not run the secret source's program", {
        source: input.source,
        error: error._tag,
      }).pipe(Effect.as(Option.some(undefined))),
    ),
  );
  if (Option.isNone(outcome)) {
    yield* Effect.logWarning("The secret source did not answer in time", { source: input.source });
    return undefined;
  }
  if (outcome.value === undefined) return undefined;
  if (outcome.value.code !== 0) {
    yield* Effect.logWarning("Could not read a secret", {
      source: input.source,
      exitCode: outcome.value.code,
    });
    return undefined;
  }
  return outcome.value.stdout;
});
