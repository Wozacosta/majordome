import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { autosaveVault } from "./vaultAutosave.ts";
import { listVaultHistory } from "./vaultHistory.ts";
import { findGitleaks } from "./vaultSecretScan.ts";
import { FAKE_GITHUB_TOKEN, gitIn, makeVault } from "./vaultTestRepos.ts";

const testLayer = Layer.mergeAll(GitVcsDriver.layer, ProcessRunner.layer).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-autosave-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.layer(testLayer)("autosaveVault", (it) => {
  it.effect("commits the owner's edits as “Your edits”, authored by the owner", () =>
    Effect.gen(function* () {
      const { root, fs } = yield* makeVault();
      yield* fs.writeFileString(`${root}/memory.md`, "- Likes tea\n- Walks at noon\n");
      yield* fs.writeFileString(`${root}/ideas.md`, "- A garden\n");

      const result = yield* autosaveVault({ cwd: root, gitleaks: yield* findGitleaks() });

      assert.equal(result.status, "saved");
      assert.equal(
        yield* gitIn(root, ["log", "-1", "--format=%an <%ae>|%cn"]),
        "Owner <owner@example.com>|Owner",
      );
      assert.equal(
        yield* gitIn(root, ["log", "-1", "--format=%s%n%b"]),
        "Your edits\n2 notes changed.",
      );
      assert.equal(yield* gitIn(root, ["status", "--porcelain"]), "");
      // The feed lists it as the owner's own change.
      const [latest] = yield* listVaultHistory({ cwd: root, limit: 1 });
      assert.deepStrictEqual(
        { subject: latest?.subject, byMajordome: latest?.byMajordome, files: latest?.files },
        { subject: "Your edits", byMajordome: false, files: ["ideas.md", "memory.md"] },
      );
      assert.equal((yield* autosaveVault({ cwd: root, gitleaks: null })).status, "nothing");
    }),
  );

  it.effect("commits nothing and leaves the edits unstaged when the scan finds a secret", () =>
    Effect.gen(function* () {
      const gitleaks = yield* findGitleaks();
      // gitleaks is part of the dev setup; without it there is no scan to test.
      if (gitleaks === null) return;
      const { root, fs } = yield* makeVault();
      yield* fs.writeFileString(
        `${root}/memory.md`,
        `- Likes tea\n- token: ${FAKE_GITHUB_TOKEN}\n`,
      );

      const result = yield* autosaveVault({ cwd: root, gitleaks });

      assert.deepStrictEqual(result, { status: "secret", files: ["memory.md"] });
      assert.equal(yield* gitIn(root, ["rev-list", "--count", "HEAD"]), "1");
      assert.equal(yield* gitIn(root, ["diff", "--cached", "--name-only"]), "");
      assert.equal(yield* gitIn(root, ["status", "--porcelain"]), "M memory.md");
    }),
  );

  it.effect("waits while a merge or rebase is unfinished", () =>
    Effect.gen(function* () {
      const { root, fs } = yield* makeVault();
      const head = yield* gitIn(root, ["rev-parse", "HEAD"]);
      yield* fs.writeFileString(`${root}/.git/MERGE_HEAD`, `${head}\n`);
      yield* fs.writeFileString(`${root}/memory.md`, "- Changed mid-merge\n");

      assert.equal(
        (yield* autosaveVault({ cwd: root, gitleaks: null })).status,
        "unfinished-merge",
      );
      assert.equal(yield* gitIn(root, ["rev-list", "--count", "HEAD"]), "1");
    }),
  );
});
