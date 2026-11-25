import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  SecretProviderId,
  SecretProviderKind,
  type ServerSettings as ServerSettingsShape,
} from "@t3tools/contracts";
import * as SecretResolverCore from "@t3tools/secret-provider-core/server/SecretResolver";
import { encryptedFileLocation } from "@t3tools/secret-provider-encrypted-file/server/store";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { builtInSecretProviderDrivers } from "../secrets/secretProviderDefinitions.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as MajordomeSavedKeys from "./MajordomeSavedKeys.ts";

export const TOTO = SecretProviderId.make("toto");
const BITWARDEN = SecretProviderId.make("bw");

/** The owner's secret sources: an Encrypted file named "toto", and Bitwarden signed in with the key `bitwarden`. */
const secretProviders: ServerSettingsShape["secretProviders"] = {
  [TOTO]: { kind: SecretProviderKind.make("encrypted_file"), label: "toto", config: {} },
  [BITWARDEN]: {
    kind: SecretProviderKind.make("bitwarden_secrets_manager"),
    label: "My Bitwarden",
    config: { tokenName: "bitwarden" },
  },
};

/** The service on its own key file, with the server's real secret sources reading that same file. */
export const layerSavedKeysForTest = (prefix: string) =>
  MajordomeSavedKeys.layer.pipe(
    Layer.provide(
      Layer.unwrap(
        Effect.gen(function* () {
          const config = yield* ServerConfig.ServerConfig;
          const path = yield* Path.Path;
          return SecretResolverCore.layer({
            drivers: builtInSecretProviderDrivers({
              encryptedFile: encryptedFileLocation(config.secretsDir, path.join),
            }),
            secretProviders: Effect.succeed(secretProviders),
          });
        }),
      ),
    ),
    Layer.provide(
      Layer.mock(ServerSettings.ServerSettingsService)({
        getSettings: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, secretProviders }),
      }),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix })),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );
