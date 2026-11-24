import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as MajordomeNotes from "./MajordomeNotes.ts";
import { commitVaultRun } from "./VaultCommitReactor.ts";
import * as VaultLock from "./VaultLock.ts";
import { commitAll, gitIn } from "./vaultTestRepos.ts";

const testLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-notes-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const projectId = ProjectId.make("vault-project");

const setUp = Effect.fn("test.setUp")(function* (options?: { readonly vault?: boolean }) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vault = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-notes-" });
  const outside = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-notes-outside-" });
  const write = (root: string, relative: string, text: string) =>
    fs
      .makeDirectory(path.dirname(path.join(root, relative)), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(path.join(root, relative), text)));
  if (options?.vault !== false) yield* write(vault, ".majordome/config.json", "{}");
  yield* write(vault, "projects/trip.md", "Paris\n");
  const service = yield* Effect.service(MajordomeNotes.MajordomeNotes).pipe(
    Effect.provide(
      MajordomeNotes.layer.pipe(
        Layer.provide(VaultLock.layer),
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: () => Effect.succeedSome({ workspaceRoot: vault } as ProjectStore.ProjectRow),
          }),
        ),
      ),
    ),
  );
  return {
    vault,
    outside,
    fs,
    path,
    write,
    save: (notePath: string, content: string, base: string) =>
      service.save({ projectId, path: notePath, content, base }),
    read: (relative: string) => fs.readFileString(path.join(vault, relative)),
  };
});

it.layer(testLayer)("MajordomeNotes", (it) => {
  it.effect("replaces a note that still reads as the editor loaded it", () =>
    Effect.gen(function* () {
      const { save, read, fs, path, vault } = yield* setUp();

      yield* save("projects/trip.md", "Paris\nLyon\n", "Paris\n");
      assert.strictEqual(yield* read("projects/trip.md"), "Paris\nLyon\n");

      // What is already there is not written again: a folder that refuses writes still saves it.
      yield* fs.chmod(path.join(vault, "projects"), 0o555);
      yield* save("projects/trip.md", "Paris\nLyon\n", "Paris\n").pipe(
        Effect.ensuring(Effect.orDie(fs.chmod(path.join(vault, "projects"), 0o755))),
      );
    }),
  );

  it.effect("leaves a note alone when it changed since the editor loaded it", () =>
    Effect.gen(function* () {
      const { save, read, write, vault } = yield* setUp();
      yield* write(vault, "projects/trip.md", "Paris, by the assistant\n");

      const error = yield* save("projects/trip.md", "Mine", "Paris\n").pipe(Effect.flip);

      // The editor tells this refusal from a passing failure by its reason, not its words.
      assert.strictEqual(error.reason, "changed");
      assert.strictEqual(yield* read("projects/trip.md"), "Paris, by the assistant\n");
    }),
  );

  it.effect("refuses anything that is not a Markdown note inside the notes folder", () =>
    Effect.gen(function* () {
      const { save, read, write, fs, path, vault, outside } = yield* setUp();
      yield* write(outside, "secret.md", "theirs");
      yield* write(vault, ".git/notes.md", "plumbing");
      yield* write(vault, "projects/data.json", "{}");
      yield* fs.makeDirectory(path.join(vault, "folder.md"));
      yield* fs.symlink(path.join(outside, "secret.md"), path.join(vault, "linked.md"));
      yield* fs.symlink(outside, path.join(vault, "away"));

      const refused = (notePath: string) =>
        save(notePath, "mine", "theirs").pipe(
          Effect.flip,
          Effect.map((error) => {
            assert.isUndefined(error.reason);
            return error.message;
          }),
        );
      const outsideMessage = "That note is not in your notes folder.";
      const goneMessage = "That note is no longer in your notes folder.";

      assert.strictEqual(yield* refused("../secret.md"), outsideMessage);
      assert.strictEqual(yield* refused("projects/../../secret.md"), outsideMessage);
      assert.strictEqual(yield* refused(path.join(outside, "secret.md")), outsideMessage);
      assert.strictEqual(yield* refused(path.join(vault, "projects/trip.md")), outsideMessage);
      assert.strictEqual(yield* refused("linked.md"), outsideMessage);
      assert.strictEqual(yield* refused("away/secret.md"), outsideMessage);
      assert.strictEqual(yield* refused(".git/notes.md"), outsideMessage);
      assert.strictEqual(yield* refused(".majordome/config.md"), outsideMessage);
      assert.strictEqual(yield* refused("folder.md"), outsideMessage);
      assert.strictEqual(yield* refused(""), outsideMessage);
      assert.strictEqual(
        yield* refused("projects/data.json"),
        "Only Markdown notes can be edited here.",
      );
      assert.strictEqual(yield* refused("projects/new.md"), goneMessage);

      assert.strictEqual(yield* fs.readFileString(path.join(outside, "secret.md")), "theirs");
      assert.strictEqual(yield* read(".git/notes.md"), "plumbing");
      assert.strictEqual(yield* read("projects/data.json"), "{}");
      assert.isFalse(yield* fs.exists(path.join(vault, "projects/new.md")));
    }),
  );

  it.effect("saves the owner's edit to the instructions at once, so no run's end undoes it", () =>
    Effect.gen(function* () {
      const { save, read, write, vault } = yield* setUp();
      yield* gitIn(vault, ["init", "--quiet", "-b", "main"]);
      yield* gitIn(vault, ["config", "user.name", "Owner"]);
      yield* gitIn(vault, ["config", "user.email", "owner@example.com"]);
      yield* write(vault, "AGENTS.md", "Be kind.\n");
      yield* commitAll(vault, "init");

      yield* save("AGENTS.md", "Be brief.\n", "Be kind.\n");
      yield* commitVaultRun({ cwd: vault, message: "majordome: Later" });

      assert.strictEqual(yield* read("AGENTS.md"), "Be brief.\n");
      assert.strictEqual(
        yield* gitIn(vault, ["log", "-1", "--format=%s|%an", "--", "AGENTS.md"]),
        "Your edits|Owner",
      );
    }),
  );

  it.effect("refuses a folder that is not a notes folder", () =>
    Effect.gen(function* () {
      const { save, read } = yield* setUp({ vault: false });
      const error = yield* save("projects/trip.md", "Mine", "Paris\n").pipe(Effect.flip);
      assert.strictEqual(error.message, "That notes folder was not found.");
      assert.strictEqual(yield* read("projects/trip.md"), "Paris\n");
    }),
  );
});
