import { builtInSecretProviderDefinitions } from "@t3tools/secret-provider-definitions/registry";
import * as EncryptedFileDriver from "@t3tools/secret-provider-encrypted-file/server/driver";
import type { EncryptedFileLocation } from "@t3tools/secret-provider-encrypted-file/server/store";
import * as EnvDriver from "@t3tools/secret-provider-env/server/driver";
import * as ExecDriver from "@t3tools/secret-provider-exec/server/driver";
import * as KeychainDriver from "@t3tools/secret-provider-keychain/server/driver";
import * as OnePasswordDriver from "@t3tools/secret-provider-onepassword/server/driver";

/** In the shared registry's order. */
export const builtInSecretProviderDrivers = (options: {
  readonly encryptedFile: EncryptedFileLocation;
}) =>
  [
    KeychainDriver.driver,
    EncryptedFileDriver.makeDriver(options.encryptedFile),
    OnePasswordDriver.driver,
    ExecDriver.driver,
    EnvDriver.driver,
  ] as const;

export const secretProviderDefinitions = builtInSecretProviderDefinitions;
