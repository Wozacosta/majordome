import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import { isVaultRunner, readVaultRunner, writeVaultRunner } from "./vaultRunner.ts";

const makeVault = Effect.fn("test.makeVault")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-runner-" });
  yield* fs.makeDirectory(`${root}/.majordome`);
  return { root, fs };
});

it.layer(NodeServices.layer)("vault runner", (it) => {
  it.effect("claims a vault that has no runner yet", () =>
    Effect.gen(function* () {
      const { root, fs } = yield* makeVault();
      assert.isTrue(Option.isNone(yield* readVaultRunner(root)));

      assert.isTrue(yield* isVaultRunner({ vaultRoot: root, environmentId: "env-a" }));
      assert.equal(yield* fs.readFileString(`${root}/.majordome/runner`), "env-a\n");
      // The claim sticks: another server asking later is not the runner.
      assert.isFalse(yield* isVaultRunner({ vaultRoot: root, environmentId: "env-b" }));
      assert.isTrue(yield* isVaultRunner({ vaultRoot: root, environmentId: "env-a" }));
    }),
  );

  it.effect("reads a runner written by hand, ignoring surrounding whitespace", () =>
    Effect.gen(function* () {
      const { root, fs } = yield* makeVault();
      yield* fs.writeFileString(`${root}/.majordome/runner`, "  env-mac \n\n");
      assert.deepEqual(yield* readVaultRunner(root), Option.some("env-mac"));
      assert.isFalse(yield* isVaultRunner({ vaultRoot: root, environmentId: "env-vps" }));
    }),
  );

  it.effect("treats an empty runner file as unclaimed", () =>
    Effect.gen(function* () {
      const { root, fs } = yield* makeVault();
      yield* fs.writeFileString(`${root}/.majordome/runner`, "\n");
      assert.isTrue(yield* isVaultRunner({ vaultRoot: root, environmentId: "env-a" }));
      assert.deepEqual(yield* readVaultRunner(root), Option.some("env-a"));
    }),
  );

  it.effect("moves the runner when asked", () =>
    Effect.gen(function* () {
      const { root } = yield* makeVault();
      yield* writeVaultRunner({ vaultRoot: root, environmentId: "env-a" });
      yield* writeVaultRunner({ vaultRoot: root, environmentId: "env-b" });
      assert.isFalse(yield* isVaultRunner({ vaultRoot: root, environmentId: "env-a" }));
      assert.isTrue(yield* isVaultRunner({ vaultRoot: root, environmentId: "env-b" }));
    }),
  );

  it.effect("runs nothing when the claim cannot be written", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-runner-" });
      // No .majordome directory, so the runner file cannot be created.
      assert.isFalse(yield* isVaultRunner({ vaultRoot: root, environmentId: "env-a" }));
    }),
  );
});
