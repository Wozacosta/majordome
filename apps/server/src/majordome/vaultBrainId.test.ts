import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { readVaultBrainId } from "./vaultBrainId.ts";
import { cloneElsewhere, commitAll, gitIn, makeVault } from "./vaultTestRepos.ts";

const testLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-brain-id-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.layer(testLayer)("readVaultBrainId", (it) => {
  it.effect("is the same for every copy of a brain, and differs between brains", () =>
    Effect.gen(function* () {
      const { root, bare, fs } = yield* makeVault({ remote: true });
      const elsewhere = yield* cloneElsewhere(bare!);
      yield* fs.writeFileString(`${elsewhere}/memory.md`, "- Likes coffee\n");
      yield* commitAll(elsewhere, "Edited elsewhere");
      const other = yield* makeVault();
      // Same files, author and second would make the same first commit.
      yield* gitIn(other.root, ["commit", "--amend", "--quiet", "-m", "Another brain"]);

      const brainId = yield* readVaultBrainId(root);

      assert.equal(brainId, yield* gitIn(root, ["rev-parse", "HEAD"]));
      assert.equal(yield* readVaultBrainId(elsewhere), brainId);
      assert.notEqual(yield* readVaultBrainId(other.root), brainId);
    }),
  );

  it.effect("keeps its first root when an unrelated history is merged in", () =>
    Effect.gen(function* () {
      const { root, fs } = yield* makeVault();
      const brainId = yield* readVaultBrainId(root);
      yield* gitIn(root, ["checkout", "--quiet", "--orphan", "imported"]);
      yield* fs.writeFileString(`${root}/imported.md`, "From another vault\n");
      yield* commitAll(root, "Imported");
      yield* gitIn(root, ["checkout", "--quiet", "main"]);
      yield* gitIn(root, [
        "merge",
        "--quiet",
        "--allow-unrelated-histories",
        "--no-edit",
        "imported",
      ]);

      assert.equal(yield* readVaultBrainId(root), brainId);
    }),
  );

  it.effect("is null before the first commit", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-empty-" });
      yield* gitIn(root, ["init", "--quiet", "-b", "main"]);

      assert.equal(yield* readVaultBrainId(root), null);
    }),
  );
});
