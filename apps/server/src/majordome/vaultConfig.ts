/**
 * A folder is a Majordome vault when it has a `.majordome/` directory. Its `config.json` names the
 * vault's memory file and folder roles, and the limits on unattended runs; anything missing falls
 * back to the defaults below.
 */

import type { MajordomeRoutineLimits } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ME_DEFAULT_PATH } from "./meNote.ts";

export const VAULT_CONFIG_DIRNAME = ".majordome";
const VAULT_CONFIG_FILENAME = "config.json";

const VaultConfig = Schema.Struct({
  memory: Schema.optional(Schema.String),
  me: Schema.optional(Schema.String),
  folders: Schema.optional(
    Schema.Struct({
      daily: Schema.optional(Schema.String),
      inbox: Schema.optional(Schema.String),
      projects: Schema.optional(Schema.String),
    }),
  ),
  limits: Schema.optional(
    Schema.Struct({
      runMinutes: Schema.optional(Schema.Number),
      runsPerDay: Schema.optional(Schema.Number),
    }),
  ),
});
type VaultConfig = typeof VaultConfig.Type;

const decodeVaultConfig = Schema.decodeUnknownOption(Schema.fromJsonString(VaultConfig));
const ConfigObjectJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown), {
  space: 2,
});
const decodeConfigObject = Schema.decodeUnknownEffect(ConfigObjectJson);
const encodeConfigObject = Schema.encodeEffect(ConfigObjectJson);

const DEFAULT_ROUTINE_LIMITS: MajordomeRoutineLimits = { runMinutes: 20, runsPerDay: 20 };

export interface VaultLayout {
  readonly memory: string;
  /** The note of the owner's stable facts. */
  readonly me: string;
  readonly dailyFolder: string;
  readonly inboxFolder: string;
  /** Where new topic folders go. */
  readonly projectsFolder: string;
}

/**
 * A vault-relative path with forward slashes, or null when it is empty, absolute, climbs out of
 * the vault, or is plumbing (a dot folder).
 */
export function normalizeTopicFolder(value: string): string | null {
  const trimmed = value.trim().replaceAll("\\", "/");
  if (trimmed.startsWith("/") || /^[a-z]:/i.test(trimmed)) return null;
  const segments = trimmed.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === ".." || segment.startsWith("."))) return null;
  return segments.join("/");
}

// The config is a file any run can write, so a path it names never leads out of the vault.
function layoutOf(config: VaultConfig): VaultLayout {
  const inVault = (value: string | undefined, fallback: string) =>
    (value === undefined ? null : normalizeTopicFolder(value)) ?? fallback;
  return {
    memory: inVault(config.memory, "memory.md"),
    me: inVault(config.me, ME_DEFAULT_PATH),
    dailyFolder: inVault(config.folders?.daily, "daily"),
    inboxFolder: inVault(config.folders?.inbox, "inbox"),
    projectsFolder: inVault(config.folders?.projects, "projects"),
  };
}

/** A whole number of at least 1, or the fallback. */
function limitOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

const readConfigText = Effect.fn("majordome.readVaultConfigText")(function* (vaultRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fileSystem
    .readFileString(path.join(vaultRoot, VAULT_CONFIG_DIRNAME, VAULT_CONFIG_FILENAME))
    .pipe(Effect.option);
});

/** The vault's limits on unattended runs; a missing or unreadable config gives the defaults. */
export const readVaultLimits = Effect.fn("majordome.readVaultLimits")(function* (
  vaultRoot: string,
) {
  const limits = Option.getOrUndefined(
    Option.flatMap(yield* readConfigText(vaultRoot), decodeVaultConfig),
  )?.limits;
  return {
    runMinutes: limitOr(limits?.runMinutes, DEFAULT_ROUTINE_LIMITS.runMinutes),
    runsPerDay: limitOr(limits?.runsPerDay, DEFAULT_ROUTINE_LIMITS.runsPerDay),
  } satisfies MajordomeRoutineLimits;
});

/** Saves the limits in the vault's config, keeping everything else; fails on a config it can't read. */
export const writeVaultLimits = Effect.fn("majordome.writeVaultLimits")(function* (
  vaultRoot: string,
  limits: MajordomeRoutineLimits,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* readConfigText(vaultRoot);
  const config = Option.isSome(text) ? yield* decodeConfigObject(text.value) : {};
  yield* fileSystem.writeFileString(
    path.join(vaultRoot, VAULT_CONFIG_DIRNAME, VAULT_CONFIG_FILENAME),
    `${yield* encodeConfigObject({ ...config, limits })}\n`,
  );
});

/** None when `vaultRoot` is not a vault. A missing or unreadable config gives the defaults. */
export const readVaultLayout = Effect.fn("majordome.readVaultLayout")(function* (
  vaultRoot: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configDir = path.join(vaultRoot, VAULT_CONFIG_DIRNAME);
  const isVault = yield* fileSystem.exists(configDir).pipe(Effect.orElseSucceed(() => false));
  if (!isVault) return Option.none<VaultLayout>();
  const config = Option.flatMap(yield* readConfigText(vaultRoot), decodeVaultConfig);
  return Option.some(layoutOf(Option.getOrElse(config, () => ({}))));
});
