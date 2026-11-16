import { defineSecretProviderDriver } from "@t3tools/secret-provider-core/server/driver";
import { readCommandOutput } from "@t3tools/secret-provider-core/server/readCommandOutput";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { definition, parseExecReference } from "../shared/definition.ts";

const READ_TIMEOUT = Duration.seconds(10);

export const driver = defineSecretProviderDriver({
  kind: definition.kind,
  definition,
  read: Effect.fn("ExecDriver.read")(function* ({ command, args = [] }, references) {
    return yield* Effect.forEach(
      references,
      Effect.fnUntraced(function* (reference) {
        const name = parseExecReference(reference);
        if (name === undefined) return undefined;
        const output = yield* readCommandOutput({
          source: "exec",
          command,
          args: [...args, name],
          timeout: READ_TIMEOUT,
        });
        // Command-line tools end what they print with a line break; the secret is the text.
        const value = output?.trim();
        return value === undefined || value.length === 0 ? undefined : value;
      }),
    );
  }),
});
