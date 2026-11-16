import { defineSecretProviderDriver } from "@t3tools/secret-provider-core/server/driver";
import { readCommandOutput } from "@t3tools/secret-provider-core/server/readCommandOutput";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { definition, parseKeychainReference } from "../shared/definition.ts";

// The system tool by its full path, so nothing earlier on PATH can stand in for it.
const SECURITY_BINARY = "/usr/bin/security";
// macOS may ask the owner to allow the read; long enough to answer, short enough not to wedge.
const READ_TIMEOUT = Duration.seconds(30);

const readOne = Effect.fn("KeychainDriver.readOne")(function* (reference: string) {
  const item = parseKeychainReference(reference);
  if (item === undefined) return undefined;
  const output = yield* readCommandOutput({
    source: "keychain",
    command: SECURITY_BINARY,
    args: ["find-generic-password", "-s", item.service, "-a", item.account, "-w"],
    timeout: READ_TIMEOUT,
  });
  // `security` ends the password with one line break; any other whitespace is part of it.
  const value = output?.endsWith("\n") ? output.slice(0, -1) : output;
  return value === undefined || value.trim().length === 0 ? undefined : value;
});

export const driver = defineSecretProviderDriver({
  kind: definition.kind,
  definition,
  read: Effect.fn("KeychainDriver.read")(function* (_config, references) {
    if ((yield* HostProcess.Platform) !== "darwin") return references.map(() => undefined);
    return yield* Effect.forEach(references, readOne);
  }),
});
