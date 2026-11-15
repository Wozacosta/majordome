import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as MajordomeVaultService from "./MajordomeVaultService.ts";
import * as VaultLock from "./VaultLock.ts";
import { commitVaultRun, vaultCommitMessage } from "./VaultCommitReactor.ts";

const testLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-service-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const vaultProject = ProjectId.make("vault-project");
const codeProject = ProjectId.make("code-project");

const makeFolder = Effect.fn("test.makeFolder")(function* (options: { readonly vault: boolean }) {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-service-" });
  const run = (args: ReadonlyArray<string>) =>
    git
      .execute({ operation: "test.vaultService", cwd: root, args })
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
  yield* run(["commit", "--quiet", "-m", "My first note"]);
  return { root, run, fs };
});

const projectRow = (projectId: ProjectId, workspaceRoot: string): ProjectStore.ProjectRow => ({
  projectId,
  title: "Notes",
  hasCustomTitle: false,
  workspaceRoot,
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  pinnedAt: null,
  archivedAt: null,
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
  deletedAt: null,
});

const makeService = (roots: Readonly<Record<string, string>>) =>
  Effect.service(MajordomeVaultService.MajordomeVaultService).pipe(
    Effect.provide(
      MajordomeVaultService.layer.pipe(
        Layer.provide(VaultLock.layer),
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: (projectId) =>
              Effect.succeed(
                Option.fromNullishOr(roots[projectId]).pipe(
                  Option.map((workspaceRoot) => projectRow(projectId, workspaceRoot)),
                ),
              ),
          }),
        ),
      ),
    ),
  );

it.layer(testLayer)("MajordomeVaultService", (it) => {
  it.effect("lists a vault's runs with the thread that made them, and undoes one", () =>
    Effect.gen(function* () {
      const vault = yield* makeFolder({ vault: true });
      yield* vault.fs.writeFileString(`${vault.root}/memory.md`, "- Likes coffee\n");
      yield* commitVaultRun({
        cwd: vault.root,
        message: vaultCommitMessage({ threadTitle: "Wrong guess", runOrdinal: 2, threadId: "t-1" }),
      });
      const service = yield* makeService({ [vaultProject]: vault.root });

      const history = yield* service.listHistory({ projectId: vaultProject });
      assert.isTrue(history.isVault);
      assert.deepEqual(
        history.entries.map((entry) => [entry.subject, entry.byMajordome, entry.threadId]),
        [
          ["majordome: Wrong guess", true, "t-1"],
          ["My first note", false, null],
        ],
      );

      const result = yield* service.undo({
        projectId: vaultProject,
        commit: history.entries[0]!.commit,
      });
      assert.equal(result.status, "undone");
      assert.equal(yield* vault.fs.readFileString(`${vault.root}/memory.md`), "- Likes tea\n");
    }),
  );

  it.effect("treats folders that are not vaults, and unknown projects, as having no history", () =>
    Effect.gen(function* () {
      const code = yield* makeFolder({ vault: false });
      const commit = yield* code.run(["rev-parse", "HEAD"]);
      const service = yield* makeService({ [codeProject]: code.root });

      for (const projectId of [codeProject, ProjectId.make("missing")]) {
        assert.deepEqual(yield* service.listHistory({ projectId }), {
          isVault: false,
          entries: [],
        });
        assert.deepEqual(yield* service.undo({ projectId, commit }), { status: "not-found" });
      }
      assert.equal(yield* code.run(["rev-list", "--count", "HEAD"]), "1");
    }),
  );
});
