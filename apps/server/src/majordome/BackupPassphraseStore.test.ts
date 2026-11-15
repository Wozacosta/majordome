import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { makeKeychain, makeSecretStore } from "./BackupPassphraseStore.ts";

const testLayer = Layer.mergeAll(ProcessRunner.layer, ServerSecretStore.layer).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-passphrase-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const passphrase = `quote " backslash \\ « accents » and ${"x".repeat(40)}`;

it.layer(testLayer)("BackupPassphraseStore", (it) => {
  it.effect("keeps a passphrase in the server's secret store", () =>
    Effect.gen(function* () {
      const store = yield* makeSecretStore();
      assert.isTrue(Option.isNone(yield* store.get("vault-a")));
      yield* store.set("vault-a", passphrase);
      assert.deepStrictEqual(yield* store.get("vault-a"), Option.some(passphrase));
      yield* store.remove("vault-a");
      assert.isTrue(Option.isNone(yield* store.get("vault-a")));
    }),
  );

  it.effect("keeps a passphrase in the macOS Keychain", () =>
    Effect.gen(function* () {
      // The Keychain exists only on macOS.
      if ((yield* HostProcess.Platform) !== "darwin") return;
      // A test-only item that the test removes again; never the real backup's.
      const store = yield* makeKeychain("majordome-test-only-backup-passphrase");
      const key = `test-${yield* Random.nextInt}`;
      yield* Effect.acquireRelease(Effect.void, () => store.remove(key).pipe(Effect.ignore));
      assert.isTrue(Option.isNone(yield* store.get(key)));
      yield* store.set(key, passphrase);
      yield* store.set(key, `${passphrase} changed`);
      assert.deepStrictEqual(yield* store.get(key), Option.some(`${passphrase} changed`));
      yield* store.remove(key);
      assert.isTrue(Option.isNone(yield* store.get(key)));
    }).pipe(Effect.scoped),
  );
});
