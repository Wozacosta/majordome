import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { commitVaultRun, vaultCommitMessage, withoutNumbers } from "./VaultCommitReactor.ts";

const testLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-commit-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const makeRepo = Effect.fn("test.makeRepo")(function* (options: { readonly vault: boolean }) {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-vault-" });
  const run = (args: ReadonlyArray<string>) =>
    git
      .execute({ operation: "test.vaultCommit", cwd: root, args })
      .pipe(Effect.map((result) => result.stdout.trim()));
  yield* run(["init", "--quiet", "-b", "main"]);
  yield* run(["config", "user.name", "Owner"]);
  yield* run(["config", "user.email", "owner@example.com"]);
  if (options.vault) {
    yield* fs.makeDirectory(`${root}/.majordome`);
    yield* fs.writeFileString(`${root}/.majordome/config.json`, "{}");
  }
  yield* fs.writeFileString(`${root}/memory.md`, "- Likes tea\n");
  yield* run(["add", "--all"]);
  yield* run(["commit", "--quiet", "-m", "init"]);
  return { root, run, fs };
});

it.layer(testLayer)("commitVaultRun", (it) => {
  it.effect("commits a run's changes as Majordome", () =>
    Effect.gen(function* () {
      const { root, run, fs } = yield* makeRepo({ vault: true });
      yield* fs.writeFileString(`${root}/memory.md`, "- Likes tea\n- Prefers checklists\n");
      yield* fs.writeFileString(`${root}/inbox.md`, "- New idea\n");

      const committed = yield* commitVaultRun({
        cwd: root,
        message: vaultCommitMessage({
          threadTitle: "Plan  the week",
          runOrdinal: 3,
          threadId: "thread-1",
        }),
      });

      assert.isTrue(committed);
      assert.equal(
        yield* run(["log", "-1", "--format=%an <%ae>"]),
        "Majordome <majordome@localhost>",
      );
      assert.equal(yield* run(["log", "-1", "--format=%s"]), "majordome: Plan the week");
      assert.equal(
        yield* run(["log", "-1", "--format=%b"]),
        "Run 3 of this thread.\n\nMajordome-Thread: thread-1",
      );
      assert.equal(
        yield* run(["log", "-1", "--format=%(trailers:key=Majordome-Thread,valueonly)"]),
        "thread-1",
      );
      assert.equal(yield* run(["status", "--porcelain"]), "");
    }),
  );

  it.effect("commits even when the owner's git signs every commit", () =>
    Effect.gen(function* () {
      const { root, run, fs } = yield* makeRepo({ vault: true });
      // A signer that always fails stands in for an agent waiting on a prompt nobody answers.
      yield* run(["config", "commit.gpgsign", "true"]);
      yield* run(["config", "gpg.program", "false"]);
      yield* fs.writeFileString(`${root}/memory.md`, "- Signed elsewhere\n");

      const committed = yield* commitVaultRun({
        cwd: root,
        message: vaultCommitMessage({ threadTitle: "Signing", runOrdinal: 1, threadId: "t" }),
      });

      assert.isTrue(committed);
      assert.equal(yield* run(["status", "--porcelain"]), "");
    }),
  );

  it.effect("makes no commit when nothing changed", () =>
    Effect.gen(function* () {
      const { root, run } = yield* makeRepo({ vault: true });
      const committed = yield* commitVaultRun({ cwd: root, message: "majordome: Nothing" });
      assert.isFalse(committed);
      assert.equal(yield* run(["rev-list", "--count", "HEAD"]), "1");
    }),
  );

  it.effect("leaves a folder that is not a vault alone", () =>
    Effect.gen(function* () {
      const { root, run, fs } = yield* makeRepo({ vault: false });
      yield* fs.writeFileString(`${root}/memory.md`, "- Changed\n");
      const committed = yield* commitVaultRun({ cwd: root, message: "majordome: Code" });
      assert.isFalse(committed);
      assert.equal(yield* run(["rev-list", "--count", "HEAD"]), "1");
      assert.equal(yield* run(["status", "--porcelain"]), "M memory.md");
    }),
  );
});

it("names an untitled thread", () => {
  assert.equal(
    vaultCommitMessage({ threadTitle: "  ", runOrdinal: 1, threadId: "thread-1" }),
    "majordome: Untitled thread\n\nRun 1 of this thread.\n\nMajordome-Thread: thread-1",
  );
});

it("keeps numbers and keys the owner typed out of the notes' history", () => {
  // The first words of a chat become its title, and the title the subject of its commits.
  assert.equal(
    withoutNumbers("For later: my passport number is 19AB12345, it expires on 2 April 2031"),
    "For later: my passport number is … it expires on 2 April 2031",
  );
  assert.equal(
    withoutNumbers("My IBAN is FR76 3000 6000 0112 3456 7890 189 for the rent"),
    "My IBAN is … for the rent",
  );
  assert.equal(withoutNumbers("Save this key sk-ant-abcdefghijklmnopqrstuvwx"), "Save this key …");
  assert.equal(withoutNumbers("Call +351 900 000 001 tomorrow"), "Call … tomorrow");
  // Ordinary titles are left as they are.
  assert.equal(withoutNumbers("Plan 2027 with 3 goals"), "Plan 2027 with 3 goals");
  assert.equal(withoutNumbers("Notes for 2026-11-20"), "Notes for 2026-11-20");
  assert.equal(
    withoutNumbers("Read projects/lisbon-move/handover.md"),
    "Read projects/lisbon-move/handover.md",
  );
  assert.include(
    vaultCommitMessage({ threadTitle: "Passport 19AB12345", runOrdinal: 1, threadId: "t" }),
    "majordome: Passport …\n",
  );
});
