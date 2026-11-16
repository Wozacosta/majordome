import { defineSecretProviderDriver } from "@t3tools/secret-provider-core/server/driver";
import * as Effect from "effect/Effect";

import { definition, parseEncryptedFileReference } from "../shared/definition.ts";
import { readSecrets, type EncryptedFileLocation } from "./store.ts";

/** The file is opened once per read and its contents never leave memory. */
export const makeDriver = (location: EncryptedFileLocation) =>
  defineSecretProviderDriver({
    kind: definition.kind,
    definition,
    read: Effect.fn("EncryptedFileDriver.read")(function* (_config, references) {
      const secrets = yield* readSecrets(location).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not open the encrypted secrets file", {
            reason: error.reason,
          }).pipe(Effect.as<Readonly<Record<string, string>>>({})),
        ),
      );
      return references.map((reference) => {
        const name = parseEncryptedFileReference(reference);
        return name !== undefined && Object.hasOwn(secrets, name) ? secrets[name] : undefined;
      });
    }),
  });
