/**
 * Where a vault's folder-backup passphrase is kept: the macOS Keychain on a Mac, the server's
 * secret store (a 0600 file in its state folder) elsewhere. Small on purpose so M4's secret
 * providers can replace it.
 */

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ProcessRunner from "../processRunner.ts";

export class BackupPassphraseError extends Schema.TaggedError<BackupPassphraseError>()(
  "BackupPassphraseError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

export class BackupPassphraseStore extends Context.Service<
  BackupPassphraseStore,
  {
    readonly get: (key: string) => Effect.Effect<Option.Option<string>, BackupPassphraseError>;
    readonly set: (key: string, passphrase: string) => Effect.Effect<void, BackupPassphraseError>;
    readonly remove: (key: string) => Effect.Effect<void, BackupPassphraseError>;
  }
>()("t3/majordome/BackupPassphraseStore") {}

const KEYCHAIN_SERVICE = "Majordome backup passphrase";
// `security find-generic-password` exits with this when there is no such item.
const KEYCHAIN_ITEM_NOT_FOUND = 44;

const toBase64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const fromBase64 = (text: string) => Buffer.from(text, "base64").toString("utf8");

/**
 * The Keychain through Apple's `security` tool. The passphrase goes in on stdin (never in argv,
 * which other processes can read), base64-encoded so no character needs quoting.
 */
export const makeKeychain = Effect.fn("BackupPassphraseStore.makeKeychain")(function* (
  service: string,
) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const security = (args: ReadonlyArray<string>, stdin?: string) =>
    runner
      .run({
        command: "/usr/bin/security",
        args,
        timeout: "30 seconds",
        ...(stdin === undefined ? {} : { stdin }),
      })
      .pipe(
        Effect.mapError(
          (cause) => new BackupPassphraseError({ message: "Could not reach the Keychain.", cause }),
        ),
      );
  const quoted = (value: string) => `"${value.replaceAll(/["\\]/g, "")}"`;

  const get = Effect.fn("BackupPassphraseStore.keychainGet")(function* (key: string) {
    const result = yield* security(["find-generic-password", "-s", service, "-a", key, "-w"]);
    if (result.code === 0) return Option.some(fromBase64(result.stdout.trim()));
    if (result.code === KEYCHAIN_ITEM_NOT_FOUND) return Option.none<string>();
    return yield* new BackupPassphraseError({ message: "Could not read the Keychain." });
  });
  const set = Effect.fn("BackupPassphraseStore.keychainSet")(function* (
    key: string,
    passphrase: string,
  ) {
    const result = yield* security(
      ["-i"],
      `add-generic-password -U -s ${quoted(service)} -a ${quoted(key)} -w ${quoted(toBase64(passphrase))}\n`,
    );
    if (result.code !== 0) {
      return yield* new BackupPassphraseError({
        message: "Could not save the passphrase to the Keychain.",
      });
    }
  });
  const remove = Effect.fn("BackupPassphraseStore.keychainRemove")(function* (key: string) {
    const result = yield* security(["delete-generic-password", "-s", service, "-a", key]);
    if (result.code !== 0 && result.code !== KEYCHAIN_ITEM_NOT_FOUND) {
      return yield* new BackupPassphraseError({ message: "Could not remove the passphrase." });
    }
  });
  return BackupPassphraseStore.of({ get, set, remove });
});

export const makeSecretStore = Effect.fn("BackupPassphraseStore.makeSecretStore")(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const name = (key: string) => `majordome-backup-passphrase-${key}`;
  const mapError = Effect.mapError(
    (cause: unknown) =>
      new BackupPassphraseError({ message: "Could not use the server's secret store.", cause }),
  );
  const get = Effect.fn("BackupPassphraseStore.storeGet")(function* (key: string) {
    const bytes = yield* secrets.get(name(key)).pipe(mapError);
    return Option.map(bytes, (value) => new TextDecoder().decode(value));
  });
  const set = Effect.fn("BackupPassphraseStore.storeSet")(function* (
    key: string,
    passphrase: string,
  ) {
    yield* secrets.set(name(key), new TextEncoder().encode(passphrase)).pipe(mapError);
  });
  const remove = Effect.fn("BackupPassphraseStore.storeRemove")(function* (key: string) {
    yield* secrets.remove(name(key)).pipe(mapError);
  });
  return BackupPassphraseStore.of({ get, set, remove });
});

// Lets a dev or test server keep its items apart from the real install's.
const KEYCHAIN_SERVICE_VARIABLE = "MAJORDOME_KEYCHAIN_SERVICE";

export const layer = Layer.effect(
  BackupPassphraseStore,
  Effect.gen(function* () {
    if ((yield* HostProcess.Platform) !== "darwin") return yield* makeSecretStore();
    const service =
      (yield* HostProcess.Environment)[KEYCHAIN_SERVICE_VARIABLE]?.trim() || KEYCHAIN_SERVICE;
    return yield* makeKeychain(service);
  }),
);
