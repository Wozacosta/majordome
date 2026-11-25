import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";
import {
  defineSecretProviderDriver,
  type SecretProviderDriverServices,
} from "@t3tools/secret-provider-core/server/driver";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/process";

import { definition, parseBitwardenReference } from "../shared/definition.ts";

const BWS_BINARY = "bws";
// Each read signs in and fetches over the network; long enough for a slow link, short of a wedge.
const READ_TIMEOUT = Duration.seconds(20);

const decodeSecret = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ value: Schema.String })),
);

// The token goes in the child's environment, never its arguments, which any user can list.
const readOne = Effect.fn("BitwardenDriver.readOne")(function* (input: {
  readonly token: string;
  readonly serverUrl: string | undefined;
  readonly id: string;
}) {
  const spawnCommand = yield* resolveSpawnCommand(BWS_BINARY, [
    "secret",
    "get",
    input.id,
    "--output",
    "json",
    "--color",
    "no",
    ...(input.serverUrl === undefined ? [] : ["--server-url", input.serverUrl]),
  ]);
  const outcome = yield* spawnAndCollect(
    BWS_BINARY,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      shell: spawnCommand.shell,
      stdin: "ignore",
      env: { BWS_ACCESS_TOKEN: input.token },
      extendEnv: true,
    }),
  ).pipe(
    Effect.timeoutOption(READ_TIMEOUT),
    Effect.catch((error) =>
      Effect.logWarning("Could not run bws", { error: error._tag }).pipe(
        Effect.as(Option.some(undefined)),
      ),
    ),
  );
  if (Option.isNone(outcome)) {
    yield* Effect.logWarning("Bitwarden Secrets Manager did not answer in time");
    return undefined;
  }
  if (outcome.value === undefined) return undefined;
  // Only the exit code is logged: what bws prints can hold the secret.
  if (outcome.value.code !== 0) {
    yield* Effect.logWarning("Could not read a secret from Bitwarden Secrets Manager", {
      exitCode: outcome.value.code,
    });
    return undefined;
  }
  const secret = decodeSecret(outcome.value.stdout);
  // A secret is passed on verbatim; surrounding whitespace can be part of it.
  return Option.isSome(secret) && secret.value.value.length > 0 ? secret.value.value : undefined;
});

/**
 * `readToken` reads a key by name from the server's own key file: a server nobody sits at has no
 * other place to keep the machine account's access token.
 */
export const makeDriver = (
  readToken: (
    name: string,
  ) => Effect.Effect<string | undefined, never, SecretProviderDriverServices>,
) =>
  defineSecretProviderDriver({
    kind: definition.kind,
    definition,
    read: Effect.fn("BitwardenDriver.read")(function* ({ tokenName, serverUrl }, references) {
      const token = (yield* readToken(tokenName))?.trim();
      if (token === undefined || token === "") {
        yield* Effect.logWarning("The Bitwarden access token is not saved under its name");
        return references.map(() => undefined);
      }
      return yield* Effect.forEach(
        references,
        (reference) => {
          const id = parseBitwardenReference(reference);
          return id === undefined
            ? Effect.undefined
            : readOne({ token, serverUrl: serverUrl === "" ? undefined : serverUrl, id });
        },
        { concurrency: 4 },
      );
    }),
  });
