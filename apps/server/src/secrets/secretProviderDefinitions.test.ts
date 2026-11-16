import { expect, it } from "@effect/vitest";

import {
  builtInSecretProviderDrivers,
  secretProviderDefinitions,
} from "./secretProviderDefinitions.ts";

it("runs a driver for every secret provider the server and clients read, in their order", () => {
  const drivers = builtInSecretProviderDrivers({
    encryptedFile: { directory: "/s", secretsPath: "/s/keys.age", keyPath: "/s/keys.agekey" },
  });
  expect(drivers.map((driver) => driver.definition)).toEqual(secretProviderDefinitions.definitions);
});
