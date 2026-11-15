import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  isVaultRunner,
  moveVaultRunner,
  readVaultRunner,
  writeVaultRunner,
} from "./vaultRunner.ts";
import { gitIn, makeVault as makeGitVault } from "./vaultTestRepos.ts";

const gitLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-runner-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

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

it.layer(gitLayer)("moving a vault's runner", (it) => {
  it.effect("commits the move right away, as Majordome, and nothing else", () =>
    Effect.gen(function* () {
      const { root, fs } = yield* makeGitVault();
      yield* fs.writeFileString(`${root}/.majordome/runner`, "env-mac\n");
      yield* gitIn(root, ["add", "--all"]);
      yield* gitIn(root, ["commit", "--quiet", "-m", "Your edits"]);
      // The owner's unsaved edits wait for their own save.
      yield* fs.writeFileString(`${root}/memory.md`, "- Likes coffee\n");
      yield* gitIn(root, ["config", "commit.gpgsign", "true"]);

      assert.isTrue(
        yield* moveVaultRunner({ vaultRoot: root, environmentId: "env-vps", serverLabel: "vps" }),
      );
      assert.equal(
        yield* gitIn(root, ["log", "-1", "--format=%an|%s|%G?"]),
        "Majordome|majordome: Routines run on vps|N",
      );
      assert.equal(
        yield* gitIn(root, ["show", "--format=", "--name-only", "HEAD"]),
        ".majordome/runner",
      );
      assert.equal(yield* gitIn(root, ["show", "HEAD:.majordome/runner"]), "env-vps");
      assert.equal(yield* gitIn(root, ["status", "--porcelain"]), "M memory.md");
      // Moving it to where it already is changes nothing.
      assert.isFalse(
        yield* moveVaultRunner({ vaultRoot: root, environmentId: "env-vps", serverLabel: "vps" }),
      );
    }),
  );
});
