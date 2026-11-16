import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { makeDriver } from "./driver.ts";
import {
  encryptedFileLocation,
  listSecretNames,
  readSecrets,
  removeSecret,
  setSecret,
  type EncryptedFileLocation,
} from "./store.ts";

const layer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

const withStore = <A, E, R>(run: (location: EncryptedFileLocation) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-secret-file-" });
    return yield* run(encryptedFileLocation(path.join(home, "secrets"), path.join));
  }).pipe(Effect.scoped, Effect.provide(layer));

const reason = <A, R>(effect: Effect.Effect<A, { readonly reason: string }, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

describe("encrypted secrets file", () => {
  it.effect("keeps what was saved, encrypted on disk and private to the server's user", () =>
    withStore(
      Effect.fnUntraced(function* (location) {
        const fileSystem = yield* FileSystem.FileSystem;
        yield* setSecret(location, "openai", "sk-live-0123456789");
        yield* setSecret(location, "notion", " padded value\n");
        yield* setSecret(location, "openai", "sk-live-rotated");

        assert.deepStrictEqual(yield* readSecrets(location), {
          openai: "sk-live-rotated",
          notion: " padded value\n",
        });
        assert.deepStrictEqual(yield* listSecretNames(location), ["notion", "openai"]);

        const onDisk = new TextDecoder().decode(yield* fileSystem.readFile(location.secretsPath));
        assert.isTrue(onDisk.startsWith("age-encryption.org/v1"));
        for (const plain of ["sk-live", "padded value", "openai", "notion"]) {
          assert.notInclude(onDisk, plain);
        }
        for (const file of [location.secretsPath, location.keyPath]) {
          assert.strictEqual((yield* fileSystem.stat(file)).mode & 0o777, 0o600, file);
        }
        // Nothing but the two files: no temporary or decrypted copy is left behind.
        assert.deepStrictEqual((yield* fileSystem.readDirectory(location.directory)).toSorted(), [
          "integration-keys.age",
          "integration-keys.agekey",
        ]);
      }),
    ),
  );

  it.effect("answers the driver in input order and reads anything else as undefined", () =>
    withStore(
      Effect.fnUntraced(function* (location) {
        const driver = makeDriver(location);
        assert.deepStrictEqual(yield* driver.read({}, ["secret://openai"]), [undefined]);

        yield* setSecret(location, "openai", "sk-live");
        yield* setSecret(location, "constructor", "sk-named-oddly");
        assert.deepStrictEqual(
          yield* driver.read({}, [
            "secret://missing",
            "secret://openai",
            "secret://toString",
            "secret://constructor",
            "secret://../openai",
            "openai",
          ]),
          [undefined, "sk-live", undefined, "sk-named-oddly", undefined, undefined],
        );
      }),
    ),
  );

  it.effect("removes one secret and keeps the others", () =>
    withStore(
      Effect.fnUntraced(function* (location) {
        yield* setSecret(location, "openai", "sk-a");
        yield* setSecret(location, "notion", "sk-b");
        assert.isTrue(yield* removeSecret(location, "openai"));
        assert.isFalse(yield* removeSecret(location, "openai"));
        assert.deepStrictEqual(yield* readSecrets(location), { notion: "sk-b" });
      }),
    ),
  );

  it.effect("refuses names and values it could not hand back", () =>
    withStore(
      Effect.fnUntraced(function* (location) {
        for (const name of ["", "-x", "../x", "a b", "a/b"]) {
          assert.strictEqual(yield* reason(setSecret(location, name, "value")), "invalid-name");
        }
        for (const value of ["", "  \n", "x".repeat(64 * 1024 + 1)]) {
          assert.strictEqual(yield* reason(setSecret(location, "openai", value)), "invalid-value");
        }
        assert.deepStrictEqual(yield* readSecrets(location), {});
      }),
    ),
  );

  it.effect("will not open the file with a key other users can read, or with no key", () =>
    withStore(
      Effect.fnUntraced(function* (location) {
        const fileSystem = yield* FileSystem.FileSystem;
        const driver = makeDriver(location);
        yield* setSecret(location, "openai", "sk-live");

        yield* fileSystem.chmod(location.keyPath, 0o644);
        assert.strictEqual(yield* reason(readSecrets(location)), "key-exposed");
        assert.deepStrictEqual(yield* driver.read({}, ["secret://openai"]), [undefined]);
        yield* fileSystem.chmod(location.keyPath, 0o600);
        assert.deepStrictEqual(yield* driver.read({}, ["secret://openai"]), ["sk-live"]);

        // A new key must never be made for secrets an old key locked: that would hide the loss.
        yield* fileSystem.remove(location.keyPath);
        assert.strictEqual(yield* reason(readSecrets(location)), "key-missing");
        assert.strictEqual(yield* reason(setSecret(location, "notion", "sk-b")), "key-missing");
        assert.isFalse(yield* fileSystem.exists(location.keyPath));
      }),
    ),
  );

  it.effect("reports a damaged file without quoting it", () =>
    withStore(
      Effect.fnUntraced(function* (location) {
        const fileSystem = yield* FileSystem.FileSystem;
        yield* setSecret(location, "openai", "sk-live");
        const encrypted = yield* fileSystem.readFile(location.secretsPath);
        encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 0xff;
        yield* fileSystem.writeFile(location.secretsPath, encrypted);

        const error = yield* Effect.flip(readSecrets(location));
        assert.strictEqual(error.reason, "undecryptable");
        assert.notInclude(JSON.stringify(error), "sk-live");
        assert.deepStrictEqual(yield* makeDriver(location).read({}, ["secret://openai"]), [
          undefined,
        ]);
      }),
    ),
  );
});
