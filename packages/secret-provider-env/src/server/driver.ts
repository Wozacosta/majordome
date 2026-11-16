import { defineSecretProviderDriver } from "@t3tools/secret-provider-core/server/driver";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import { definition, parseEnvReference } from "../shared/definition.ts";

export const driver = defineSecretProviderDriver({
  kind: definition.kind,
  definition,
  read: Effect.fn("EnvDriver.read")(function* (_config, references) {
    const environment = yield* HostProcess.Environment;
    return references.map((reference) => {
      const name = parseEnvReference(reference);
      // Own properties only, so a name like `constructor` never reads something inherited.
      const value =
        name !== undefined && Object.hasOwn(environment, name) ? environment[name] : undefined;
      return value === undefined || value.trim().length === 0 ? undefined : value;
    });
  }),
});
