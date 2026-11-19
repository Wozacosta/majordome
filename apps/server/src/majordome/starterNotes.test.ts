import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { collectStarterNotes } from "../../scripts/starter-notes.ts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import starter from "./starterNotes.json" with { type: "json" };
import { isTooBroadForNotes, setUpNotesFolder } from "./starterNotes.ts";
import { readVaultBrainId } from "./vaultBrainId.ts";
import { readVaultLayout } from "./vaultConfig.ts";
import { gitIn } from "./vaultTestRepos.ts";

const testLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-starter-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.layer(testLayer)("starter notes", (it) => {
  it.effect("matches obrain; run `vp run starter-notes:sync` in apps/server", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const obrain = path.join(import.meta.dirname, "../../../../packages/obrain");
      assert.deepStrictEqual(starter, yield* Effect.promise(() => collectStarterNotes(obrain)));
    }),
  );

  it.effect("makes an empty folder a notes folder with a first commit", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const parent = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-starter-" });
      const root = `${parent}/Majordome`;

      const { added } = yield* setUpNotesFolder(root);

      assert.deepStrictEqual(Option.getOrThrow(yield* readVaultLayout(root)), {
        memory: "memory.md",
        dailyFolder: "daily",
        inboxFolder: "drop",
        projectsFolder: "projects",
      });
      assert.isTrue(yield* fs.exists(`${root}/.claude/skills/morning/SKILL.md`));
      assert.strictEqual(yield* fs.readFileString(`${root}/CLAUDE.md`), "@AGENTS.md\n");
      assert.isNotNull(yield* readVaultBrainId(root));
      assert.strictEqual(yield* gitIn(root, ["status", "--porcelain"]), "");
      assert.deepStrictEqual(
        (yield* gitIn(root, ["ls-files"])).split("\n").toSorted(),
        added.toSorted(),
      );
    }),
  );

  it.effect("keeps what a folder already holds and leaves its notes uncommitted", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-starter-" });
      yield* fs.writeFileString(`${root}/CLAUDE.md`, "My own instructions\n");
      yield* fs.writeFileString(`${root}/memory.md`, "- Likes tea\n");
      yield* fs.writeFileString(`${root}/journal.md`, "Dear diary\n");

      const first = yield* setUpNotesFolder(root);
      const second = yield* setUpNotesFolder(root);

      assert.strictEqual(yield* fs.readFileString(`${root}/CLAUDE.md`), "My own instructions\n");
      assert.strictEqual(yield* fs.readFileString(`${root}/memory.md`), "- Likes tea\n");
      assert.isFalse(yield* fs.exists(`${root}/AGENTS.md`));
      assert.notInclude(first.added, "memory.md");
      assert.deepStrictEqual(second.added, []);
      assert.strictEqual(
        yield* gitIn(root, ["status", "--porcelain"]),
        "?? CLAUDE.md\n?? journal.md\n?? memory.md",
      );
    }),
  );

  it.effect("refuses a folder inside another repository", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const repo = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-starter-" });
      yield* gitIn(repo, ["init", "--quiet", "-b", "main"]);

      const error = yield* setUpNotesFolder(`${repo}/notes`).pipe(Effect.flip);

      assert.strictEqual(error._tag, "NotesFolderError");
      assert.isFalse(yield* fs.exists(`${repo}/notes/.majordome`));
    }),
  );

  it.effect("calls the home folder, its parents and its shared folders too broad", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const broad = (folder: string) => isTooBroadForNotes({ folder, home: "/Users/sam", path });
      assert.deepStrictEqual(
        ["/", "/Users", "/Users/sam", "/Users/sam/Documents", "/Users/sam/Documents/"].map(broad),
        [true, true, true, true, true],
      );
      assert.deepStrictEqual(
        ["/Users/sam/Majordome", "/Users/sam/Documents/Notes", "/Volumes/Disk/notes"].map(broad),
        [false, false, false],
      );
    }),
  );
});
