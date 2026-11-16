import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { planMemoryPass } from "./memoryPass.ts";
import { MEMORY_CHAR_LIMIT } from "./memoryPassPrompt.ts";
import type { MemoryPassState } from "./memoryPassState.ts";
import { commitVaultRun } from "./VaultCommitReactor.ts";
import { commitAll, gitIn, makeVault } from "./vaultTestRepos.ts";

const testLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-memory-pass-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const layout = {
  memory: "memory.md",
  dailyFolder: "daily",
  inboxFolder: "inbox",
  projectsFolder: "projects",
};
const LAST_PASS = "2026-11-15T02:30:00.000Z";

const setUp = Effect.fn("test.setUp")(function* () {
  const { root, fs } = yield* makeVault();
  const write = (file: string, contents: string) =>
    fs
      .makeDirectory(`${root}/${file}`.slice(0, `${root}/${file}`.lastIndexOf("/")), {
        recursive: true,
      })
      .pipe(Effect.andThen(fs.writeFileString(`${root}/${file}`, contents)));
  const previous: MemoryPassState = {
    head: yield* gitIn(root, ["rev-parse", "HEAD"]),
    brief: { since: null, preparedAt: LAST_PASS, files: [], more: 0, memoryChars: 11 },
  };
  const plan = (options?: { readonly passTitle?: string; readonly first?: boolean }) =>
    planMemoryPass({
      vaultRoot: root,
      layout,
      previous: options?.first ? Option.none() : Option.some(previous),
      passTitle: options?.passTitle ?? "Tidy my memory",
      now: DateTime.makeUnsafe("2026-11-16T02:30:00.000Z"),
    });
  const run = (subject: string) => commitVaultRun({ cwd: root, message: subject });
  return { root, fs, write, plan, run };
});

it.layer(testLayer)("planMemoryPass", (it) => {
  it.effect("lists the notes that changed since the last pass, newest first", () =>
    Effect.gen(function* () {
      const { root, fs, write, plan, run } = yield* setUp();
      yield* write("daily/2026-11-15.md", "- My accountant is Ana");
      yield* write("old/gone.md", "- Deleted below");
      yield* write("memory.md", "- Likes tea\n- Likes coffee");
      yield* write("CLAUDE.md", "Rules");
      yield* write("attachments/receipt.png", "png");
      yield* commitAll(root, "Your edits");
      yield* write("projects/flat/notes.md", "- Visit on Friday");
      yield* fs.remove(`${root}/old/gone.md`);
      yield* run("majordome: Flat hunt");
      yield* write("inbox/letter.md", "Not saved yet");

      const planned = yield* plan();
      assert.deepEqual(planned?.brief.files, [
        "inbox/letter.md",
        "projects/flat/notes.md",
        "daily/2026-11-15.md",
      ]);
      assert.equal(planned?.brief.since, LAST_PASS);
      assert.equal(planned?.head, yield* gitIn(root, ["rev-parse", "HEAD"]));
    }),
  );

  it.effect("finds nothing new in what Majordome's own routines and undos wrote", () =>
    Effect.gen(function* () {
      const { write, plan, run } = yield* setUp();
      yield* write("daily/2026-11-16.md", "# Monday");
      yield* run("majordome: Start my day");
      yield* write("reviews/2026-w46.md", "# Week 46");
      yield* run("majordome: Review my week");
      yield* write("projects/flat/log.md", "- 2026-11-14: Budget is 1,400");
      yield* run("majordome: Night tidy");
      yield* write("projects/flat/log.md", "");
      yield* run("Undo: majordome: Night tidy");

      assert.isNull(yield* plan({ passTitle: "Night tidy" }));
      // Under another name, the run that wrote the log is a conversation like any other.
      assert.deepEqual((yield* plan())?.brief.files, ["projects/flat/log.md"]);
    }),
  );

  it.effect("runs for a memory note over its limit, and looks back a week the first time", () =>
    Effect.gen(function* () {
      const { root, write, plan } = yield* setUp();
      assert.isNull(yield* plan());

      yield* write("memory.md", "x".repeat(MEMORY_CHAR_LIMIT + 1));
      yield* commitAll(root, "Your edits");
      const overLimit = yield* plan();
      assert.deepEqual(overLimit?.brief.files, []);
      assert.equal(overLimit?.brief.memoryChars, MEMORY_CHAR_LIMIT + 1);

      yield* write("daily/2026-11-15.md", "- Moved to Lisbon");
      yield* commitAll(root, "Your edits");
      const first = yield* plan({ first: true });
      assert.deepEqual(first?.brief.files, ["daily/2026-11-15.md"]);
      assert.isNull(first?.brief.since);
    }),
  );
});
