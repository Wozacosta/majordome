/**
 * A folder is a Majordome vault when it has a `.majordome/` directory. Its `config.json` names the
 * vault's memory file and folder roles; anything missing falls back to the defaults below.
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export const VAULT_CONFIG_DIRNAME = ".majordome";
const VAULT_CONFIG_FILENAME = "config.json";

const VaultConfig = Schema.Struct({
  memory: Schema.optional(Schema.String),
  folders: Schema.optional(
    Schema.Struct({
      daily: Schema.optional(Schema.String),
      inbox: Schema.optional(Schema.String),
    }),
  ),
});
type VaultConfig = typeof VaultConfig.Type;

const decodeVaultConfig = Schema.decodeUnknownOption(Schema.fromJsonString(VaultConfig));

export interface VaultLayout {
  readonly memory: string;
  readonly dailyFolder: string;
  readonly inboxFolder: string;
}

function layoutOf(config: VaultConfig): VaultLayout {
  return {
    memory: config.memory ?? "memory.md",
    dailyFolder: config.folders?.daily ?? "daily",
    inboxFolder: config.folders?.inbox ?? "inbox",
  };
}

/** None when `vaultRoot` is not a vault. A missing or unreadable config gives the defaults. */
export const readVaultLayout = Effect.fn("majordome.readVaultLayout")(function* (
  vaultRoot: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configDir = path.join(vaultRoot, VAULT_CONFIG_DIRNAME);
  const isVault = yield* fileSystem.exists(configDir).pipe(Effect.orElseSucceed(() => false));
  if (!isVault) return Option.none<VaultLayout>();
  const config = Option.flatMap(
    yield* fileSystem
      .readFileString(path.join(configDir, VAULT_CONFIG_FILENAME))
      .pipe(Effect.option),
    decodeVaultConfig,
  );
  return Option.some(layoutOf(Option.getOrElse(config, () => ({}))));
});
