import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { commitVaultRun, vaultCommitMessage } from "./VaultCommitReactor.ts";
import { listVaultHistory, undoVaultCommit } from "./vaultHistory.ts";

const testLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-history-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const makeVault = Effect.fn("test.makeVault")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-vault-" });
  const run = (args: ReadonlyArray<string>) =>
    git
      .execute({ operation: "test.vaultHistory", cwd: root, args })
      .pipe(Effect.map((result) => result.stdout.trim()));
  yield* run(["init", "--quiet", "-b", "main"]);
  yield* run(["config", "user.name", "Owner"]);
  yield* run(["config", "user.email", "owner@example.com"]);
  yield* fs.makeDirectory(`${root}/.majordome`);
  yield* fs.writeFileString(`${root}/.majordome/config.json`, "{}");
  yield* fs.writeFileString(`${root}/memory.md`, "- Likes tea\n");
  yield* run(["add", "--all"]);
  yield* run(["commit", "--quiet", "-m", "My first note"]);
  const write = (file: string, contents: string) =>
    fs
      .makeDirectory(`${root}/${file}`.slice(0, `${root}/${file}`.lastIndexOf("/")), {
        recursive: true,
      })
      .pipe(Effect.andThen(fs.writeFileString(`${root}/${file}`, contents)));
  const read = (file: string) => fs.readFileString(`${root}/${file}`);
  const agentRun = (message: string) => commitVaultRun({ cwd: root, message });
  return { root, run, write, read, agentRun };
});

it.layer(testLayer)("vault history", (it) => {
  it.effect("lists runs and the owner's commits, newest first, with their notes", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      yield* vault.write("memory.md", "- Likes tea\n- Prefers checklists\n");
      yield* vault.write("daily/2026-11-15.md", "- [ ] Call the bank\n");
      yield* vault.agentRun(
        vaultCommitMessage({ threadTitle: "Start my day", runOrdinal: 1, threadId: "thread-7" }),
      );

      const history = yield* listVaultHistory({ cwd: vault.root, limit: 10 });

      assert.equal(history.length, 2);
      const [latest, first] = history;
      assert.equal(latest?.subject, "majordome: Start my day");
      assert.equal(latest?.body, "Run 1 of this thread.");
      assert.equal(latest?.threadId, "thread-7");
      assert.isTrue(latest?.byMajordome);
      assert.deepEqual([...(latest?.files ?? [])].sort(), ["daily/2026-11-15.md", "memory.md"]);
      assert.equal(first?.subject, "My first note");
      assert.isFalse(first?.byMajordome);
      assert.isNull(first?.threadId);
      assert.equal(first?.authorName, "Owner");
    }),
  );

  it.effect("undoes a run with a new commit", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      yield* vault.write("memory.md", "- Likes coffee\n");
      yield* vault.agentRun("majordome: Wrong guess");
      const [run] = yield* listVaultHistory({ cwd: vault.root, limit: 1 });

      const result = yield* undoVaultCommit({ cwd: vault.root, commit: run!.commit });

      assert.equal(result.status, "undone");
      assert.equal(yield* vault.read("memory.md"), "- Likes tea\n");
      assert.equal(yield* vault.run(["log", "-1", "--format=%s"]), "Undo: majordome: Wrong guess");
      assert.equal(yield* vault.run(["rev-list", "--count", "HEAD"]), "3");
    }),
  );

  it.effect("refuses when later changes touched the same lines", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      yield* vault.write("memory.md", "- Likes coffee\n");
      yield* vault.agentRun("majordome: First run");
      const [first] = yield* listVaultHistory({ cwd: vault.root, limit: 1 });
      yield* vault.write("memory.md", "- Likes coffee, black\n");
      yield* vault.agentRun("majordome: Second run");

      const result = yield* undoVaultCommit({ cwd: vault.root, commit: first!.commit });

      assert.deepEqual(result, { status: "conflict", files: ["memory.md"] });
      assert.equal(yield* vault.read("memory.md"), "- Likes coffee, black\n");
      assert.equal(yield* vault.run(["status", "--porcelain"]), "");
    }),
  );

  it.effect("refuses while the run's notes have unsaved edits", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      yield* vault.write("memory.md", "- Likes coffee\n");
      yield* vault.agentRun("majordome: A run");
      const [run] = yield* listVaultHistory({ cwd: vault.root, limit: 1 });
      yield* vault.write("memory.md", "- Typing right now\n");

      const result = yield* undoVaultCommit({ cwd: vault.root, commit: run!.commit });

      assert.deepEqual(result, { status: "unsaved-changes", files: ["memory.md"] });
      assert.equal(yield* vault.read("memory.md"), "- Typing right now\n");
    }),
  );

  it.effect("does not run arbitrary input as a commit", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      assert.deepEqual(yield* undoVaultCommit({ cwd: vault.root, commit: "--help" }), {
        status: "not-found",
      });
      assert.deepEqual(yield* undoVaultCommit({ cwd: vault.root, commit: "deadbeef" }), {
        status: "not-found",
      });
    }),
  );
});
