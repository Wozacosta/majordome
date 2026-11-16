import * as SecretResolverCore from "@t3tools/secret-provider-core/server/SecretResolver";
import { encryptedFileLocation } from "@t3tools/secret-provider-encrypted-file/server/store";
import type { ServerSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { builtInSecretProviderDrivers } from "./secretProviderDefinitions.ts";
import * as Settings from "../serverSettings.ts";

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const serverSettings = yield* Settings.ServerSettingsService;
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return SecretResolverCore.layer({
      drivers: builtInSecretProviderDrivers({
        encryptedFile: encryptedFileLocation(config.secretsDir, path.join),
      }),
      secretProviders: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.secretProviders),
        Effect.orElseSucceed((): ServerSettings["secretProviders"] => ({})),
      ),
    });
  }),
);
