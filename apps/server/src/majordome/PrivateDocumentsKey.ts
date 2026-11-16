/**
 * The `age` identity private documents are encrypted to, made on first use: the Keychain on a Mac,
 * the server's secret store (a 0600 file beside the ciphertext) elsewhere. So on a headless server
 * a copy of the whole state folder can decrypt, and on any host whoever controls the server can.
 */

import * as HostProcess from "@t3tools/shared/HostProcess";
import { generateX25519Identity } from "age-encryption";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as BackupPassphraseStore from "./BackupPassphraseStore.ts";

export class PrivateDocumentsKeyError extends Schema.TaggedError<PrivateDocumentsKeyError>()(
  "PrivateDocumentsKeyError",
  { operation: Schema.Literals(["read", "create"]), cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not reach the key that protects private documents.";
  }
}

export class PrivateDocumentsKey extends Context.Service<
  PrivateDocumentsKey,
  {
    /** The `AGE-SECRET-KEY-1…` identity, created the first time it is asked for. */
    readonly identity: Effect.Effect<string, PrivateDocumentsKeyError>;
  }
>()("t3/majordome/PrivateDocumentsKey") {}

const KEYCHAIN_SERVICE = "Majordome private documents";
const KEYCHAIN_ACCOUNT = "identity";
const SECRET_STORE_NAME = "majordome-private-documents-identity";
// The variable `BackupPassphraseStore` reads, so a dev or test server stays out of the real items.
const KEYCHAIN_SERVICE_VARIABLE = "MAJORDOME_KEYCHAIN_SERVICE";

const generate = Effect.tryPromise({
  try: () => generateX25519Identity(),
  catch: (cause) => new PrivateDocumentsKeyError({ operation: "create", cause }),
});

/** Reads the identity, or makes and saves one; one caller at a time so two never make two keys. */
const getOrCreate = Effect.fn("PrivateDocumentsKey.getOrCreate")(function* <E1, E2>(store: {
  readonly get: Effect.Effect<Option.Option<string>, E1>;
  readonly set: (identity: string) => Effect.Effect<void, E2>;
}) {
  const lock = yield* Semaphore.make(1);
  const identity = Effect.gen(function* () {
    const existing = yield* store.get.pipe(
      Effect.mapError((cause) => new PrivateDocumentsKeyError({ operation: "read", cause })),
    );
    if (Option.isSome(existing) && existing.value.trim() !== "") return existing.value.trim();
    const created = yield* generate;
    yield* store
      .set(created)
      .pipe(
        Effect.mapError((cause) => new PrivateDocumentsKeyError({ operation: "create", cause })),
      );
    return created;
  }).pipe(lock.withPermits(1), Effect.withSpan("PrivateDocumentsKey.identity"));
  return PrivateDocumentsKey.of({ identity });
});

export const layer = Layer.effect(
  PrivateDocumentsKey,
  Effect.gen(function* () {
    if ((yield* HostProcess.Platform) === "darwin") {
      const override = (yield* HostProcess.Environment)[KEYCHAIN_SERVICE_VARIABLE]?.trim();
      const keychain = yield* BackupPassphraseStore.makeKeychain(
        override ? `${override} private documents` : KEYCHAIN_SERVICE,
      );
      return yield* getOrCreate({
        get: keychain.get(KEYCHAIN_ACCOUNT),
        set: (identity) => keychain.set(KEYCHAIN_ACCOUNT, identity),
      });
    }
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    return yield* getOrCreate({
      get: secrets
        .get(SECRET_STORE_NAME)
        .pipe(Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes)))),
      set: (identity) => secrets.set(SECRET_STORE_NAME, new TextEncoder().encode(identity)),
    });
  }),
);
