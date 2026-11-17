import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { EnvironmentId, type ProjectId, type ServerProvider } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { GITHUB_TOKEN_SECRET } from "./MajordomeBackup.ts";
import * as MajordomeMoveReceiver from "./MajordomeMoveReceiver.ts";
import * as MajordomeRoutines from "./MajordomeRoutines.ts";
import { readVaultBrainId } from "./vaultBrainId.ts";
import { createVaultBundle } from "./vaultFolderBackup.ts";
import * as VaultLock from "./VaultLock.ts";
import { commitAll, gitIn, makeVault } from "./vaultTestRepos.ts";

const testLayer = Layer.mergeAll(GitVcsDriver.layer, ProcessRunner.layer, VaultLock.layer).pipe(
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-receiver-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const SERVER_ID = EnvironmentId.make("env-server");

// Git tidies a repository in a detached process after some commands, and that process can still be
// writing when a test's folder is removed. Every git these tests start inherits this.
Object.assign(process.env, {
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "gc.auto",
  GIT_CONFIG_VALUE_0: "0",
  GIT_CONFIG_KEY_1: "maintenance.auto",
  GIT_CONFIG_VALUE_1: "false",
});

/** A new server: an empty home folder, no projects, and whichever providers the test says. */
const makeServer = Effect.fn("test.makeServer")(function* (options?: {
  readonly providerReady?: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-server-home-" });
  const created: Array<{ readonly id: ProjectId; readonly title: string; readonly root: string }> =
    [];
  const ranHere: Array<ProjectId> = [];
  const receiver = yield* Effect.service(MajordomeMoveReceiver.MajordomeMoveReceiver).pipe(
    Effect.provide(Layer.fresh(MajordomeMoveReceiver.layer)),
    Effect.provideService(HostProcess.HomeDirectory, home),
    Effect.provideService(ProjectService.ProjectService, {
      getByWorkspaceRoot: (root: string) =>
        Effect.succeed(Option.fromUndefinedOr(created.find((project) => project.root === root))),
      create: (input: { projectId: ProjectId; title: string; workspaceRoot: string }) =>
        Effect.sync(() => {
          const project = { id: input.projectId, title: input.title, root: input.workspaceRoot };
          created.push(project);
          return project;
        }),
    } as unknown as ProjectService.ProjectService["Service"]),
    Effect.provideService(ProviderRegistry.ProviderRegistry, {
      getProviders: Effect.succeed([
        {
          enabled: true,
          installed: true,
          status: options?.providerReady ? "ready" : "error",
          availability: "available",
        } as unknown as ServerProvider,
      ]),
    } as unknown as ProviderRegistry.ProviderRegistry["Service"]),
    Effect.provideService(MajordomeRoutines.MajordomeRoutines, {
      start: () => Effect.void,
      runHere: (projectId) => Effect.sync(() => void ranHere.push(projectId)),
    }),
    Effect.provideService(ServerEnvironment.ServerEnvironment, {
      getEnvironmentId: Effect.succeed(SERVER_ID),
    } as unknown as ServerEnvironment.ServerEnvironment["Service"]),
  );
  return { receiver, home, notes: `${home}/brain`, created, ranHere };
});

const bundleOf = Effect.fn("test.bundleOf")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-bundle-" });
  yield* createVaultBundle({ cwd: root, bundlePath: `${dir}/vault.bundle` });
  return `${dir}/vault.bundle`;
});

it.layer(testLayer)("MajordomeMoveReceiver", (it) => {
  it.effect("opens the copied notes with the same history, remote and owner, as a project", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      const server = yield* makeServer();
      const received = yield* server.receiver.receiveVault({
        bundlePath: yield* bundleOf(vault.root),
        title: "My notes",
        remote: { name: "origin", url: "https://github.com/owner/majordome-brain.git" },
        identity: { name: "Owner", email: "owner@example.com" },
      });

      assert.strictEqual(received.head, yield* gitIn(vault.root, ["rev-parse", "HEAD"]));
      assert.strictEqual(received.brainId, yield* readVaultBrainId(vault.root));
      assert.strictEqual(
        yield* vault.fs.readFileString(`${server.notes}/memory.md`),
        "- Likes tea\n",
      );
      assert.strictEqual(yield* gitIn(server.notes, ["symbolic-ref", "--short", "HEAD"]), "main");
      assert.strictEqual(
        yield* gitIn(server.notes, ["remote", "get-url", "origin"]),
        "https://github.com/owner/majordome-brain.git",
      );
      assert.strictEqual(yield* gitIn(server.notes, ["config", "user.email"]), "owner@example.com");
      assert.deepStrictEqual(server.created, [
        { id: received.projectId, title: "My notes", root: server.notes },
      ]);
    }),
  );

  it.effect("takes a second copy of the same notes forward, and keeps one project", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      const server = yield* makeServer();
      const first = yield* server.receiver.receiveVault({
        bundlePath: yield* bundleOf(vault.root),
        title: "My notes",
      });
      yield* vault.fs.writeFileString(`${vault.root}/later.md`, "added after the first copy\n");
      yield* commitAll(vault.root, "later");
      const second = yield* server.receiver.receiveVault({
        bundlePath: yield* bundleOf(vault.root),
        title: "My notes",
      });

      assert.strictEqual(second.projectId, first.projectId);
      assert.strictEqual(second.head, yield* gitIn(vault.root, ["rev-parse", "HEAD"]));
      assert.isTrue(yield* vault.fs.exists(`${server.notes}/later.md`));
      assert.strictEqual(server.created.length, 1);
    }),
  );

  it.effect("refuses other notes, and notes that moved on without this computer", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      // Other notes start from their own first commit.
      const other = yield* vault.fs.makeTempDirectoryScoped({ prefix: "majordome-other-" });
      yield* gitIn(other, ["init", "--quiet", "-b", "main"]);
      yield* gitIn(other, ["config", "user.name", "Someone"]);
      yield* gitIn(other, ["config", "user.email", "someone@example.com"]);
      yield* vault.fs.writeFileString(`${other}/memory.md`, "- Someone else's notes\n");
      yield* commitAll(other, "init");
      const server = yield* makeServer();
      const before = yield* bundleOf(vault.root);
      // The identity lets the test commit there on a machine with no git identity of its own.
      yield* server.receiver.receiveVault({
        bundlePath: before,
        title: "My notes",
        identity: { name: "Owner", email: "owner@example.com" },
      });

      const foreign = yield* Effect.flip(
        server.receiver.receiveVault({ bundlePath: yield* bundleOf(other), title: "Other" }),
      );
      assert.strictEqual(foreign.reason, "other-notes");

      yield* vault.fs.writeFileString(`${server.notes}/on-server.md`, "written on the server\n");
      yield* commitAll(server.notes, "server edit");
      yield* vault.fs.writeFileString(`${vault.root}/on-mac.md`, "written on the computer\n");
      yield* commitAll(vault.root, "mac edit");
      const diverged = yield* Effect.flip(
        server.receiver.receiveVault({
          bundlePath: yield* bundleOf(vault.root),
          title: "My notes",
        }),
      );
      assert.strictEqual(diverged.reason, "diverged");
      assert.isTrue(yield* vault.fs.exists(`${server.notes}/on-server.md`));
    }),
  );

  it.effect("hands its notes back with edits not saved yet", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      const server = yield* makeServer();
      const empty = yield* Effect.flip(server.receiver.sendVault(`${server.home}/none.bundle`));
      assert.strictEqual(empty.reason, "no-notes");

      yield* server.receiver.receiveVault({
        bundlePath: yield* bundleOf(vault.root),
        title: "My notes",
        identity: { name: "Owner", email: "owner@example.com" },
      });
      yield* vault.fs.writeFileString(`${server.notes}/from-routine.md`, "the server wrote this\n");
      const out = `${server.home}/out.bundle`;
      yield* server.receiver.sendVault(out);

      yield* gitIn(vault.root, ["fetch", "--quiet", out, "+HEAD:refs/majordome/server"]);
      yield* gitIn(vault.root, ["merge", "--quiet", "--ff-only", "refs/majordome/server"]);
      assert.strictEqual(
        yield* vault.fs.readFileString(`${vault.root}/from-routine.md`),
        "the server wrote this\n",
      );
    }),
  );

  it.effect("stores the GitHub sign-in, reports provider readiness, and takes the routines", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      const signedOut = yield* makeServer();
      yield* signedOut.receiver.receiveVault({
        bundlePath: yield* bundleOf(vault.root),
        title: "My notes",
      });
      assert.deepStrictEqual(yield* signedOut.receiver.routines(), {
        canRun: false,
        runsHere: false,
      });

      const ready = yield* makeServer({ providerReady: true });
      const noNotes = yield* Effect.flip(ready.receiver.runRoutinesHere());
      assert.strictEqual(noNotes.reason, "no-notes");
      const received = yield* ready.receiver.receiveVault({
        bundlePath: yield* bundleOf(vault.root),
        title: "My notes",
      });
      assert.isTrue((yield* ready.receiver.routines()).canRun);
      yield* ready.receiver.runRoutinesHere();
      assert.deepStrictEqual(ready.ranHere, [received.projectId]);

      yield* ready.receiver.setGitHubToken("gho_test");
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      assert.strictEqual(
        new TextDecoder().decode(Option.getOrThrow(yield* secrets.get(GITHUB_TOKEN_SECRET))),
        "gho_test",
      );
    }),
  );
});
