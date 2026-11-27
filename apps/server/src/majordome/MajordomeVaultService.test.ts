import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as MajordomeNotesSearch from "./MajordomeNotesSearch.ts";
import * as MajordomeVaultService from "./MajordomeVaultService.ts";
import * as RoutineRunLedger from "./RoutineRunLedger.ts";
import { setUpNotesFolder } from "./starterNotes.ts";
import * as VaultLock from "./VaultLock.ts";
import { gitIn } from "./vaultTestRepos.ts";
import { commitVaultRun, vaultCommitMessage } from "./VaultCommitReactor.ts";
import { createVaultBundle, encryptFile } from "./vaultFolderBackup.ts";

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
  trackedFolders: [],
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

/** A thread's runs as the projection holds them: ordinal, final reply, and the task that sent it. */
interface FakeRun {
  readonly ordinal: number;
  readonly reply: string;
  readonly scheduledTaskId?: string;
}

const fakeProjections = (threads: Readonly<Record<string, ReadonlyArray<FakeRun>>>) => {
  const runsOf = (
    threadId: ThreadId,
  ): Effect.Effect<ReadonlyArray<FakeRun>, ProjectionStore.ProjectionStoreThreadNotFoundError> => {
    const runs = threads[threadId];
    return runs === undefined
      ? Effect.fail(new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId }))
      : Effect.succeed(runs);
  };
  const createdAt = DateTime.makeUnsafe("2026-11-15T08:00:00.000Z");
  return Layer.mock(ProjectionStore.ProjectionStoreV2)({
    getThreadRecords: (threadId, fields) =>
      runsOf(threadId).pipe(
        Effect.map(
          (runs) =>
            ({
              thread: null,
              runs: runs.map((run) => ({
                id: `${threadId}:run-${run.ordinal}`,
                ordinal: run.ordinal,
                userMessageId: `${threadId}:prompt-${run.ordinal}`,
              })),
              messages: (fields as ReadonlyArray<string>).includes("messages")
                ? runs.map((run) => ({
                    id: `${threadId}:reply-${run.ordinal}`,
                    runId: `${threadId}:run-${run.ordinal}`,
                    role: "assistant",
                    text: run.reply,
                    createdAt,
                  }))
                : [],
            }) as never,
        ),
      ),
    getMessagesById: (threadId, ids) =>
      runsOf(threadId).pipe(
        Effect.map(
          (runs) =>
            new Map(
              runs
                .map((run) => [`${threadId}:prompt-${run.ordinal}`, run] as const)
                .filter(([id]) => (ids as ReadonlyArray<string>).includes(id))
                .map(([id, run]) => [id, { id, scheduledTaskId: run.scheduledTaskId }]),
            ) as never,
        ),
      ),
  });
};

const makeService = (
  roots: Readonly<Record<string, string>>,
  threads: Readonly<Record<string, ReadonlyArray<FakeRun>>> = {},
) => {
  const opened = new Map<string, { readonly id: ProjectId; readonly workspaceRoot: string }>();
  return Effect.service(MajordomeVaultService.MajordomeVaultService).pipe(
    Effect.provide(
      MajordomeVaultService.layer.pipe(
        Layer.provide(VaultLock.layer),
        Layer.provide(RoutineRunLedger.layer),
        Layer.provide(
          Layer.mock(MajordomeNotesSearch.MajordomeNotesSearch)({
            refreshInBackground: () => Effect.void,
          }),
        ),
        Layer.provide(fakeProjections(threads)),
        // A server with no routines made and no provider signed in.
        Layer.provide(
          Layer.mock(ScheduledTaskService.ScheduledTaskService)({
            list: () => Effect.succeed({ tasks: [] }),
          }),
        ),
        Layer.provide(
          Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
        ),
        Layer.provide(
          Layer.mock(ServerEnvironment.ServerEnvironment)({
            getEnvironmentId: Effect.succeed(EnvironmentId.make("env-here")),
          }),
        ),
        Layer.provide(
          Layer.mock(ProjectService.ProjectService)({
            getByWorkspaceRoot: (workspaceRoot) =>
              Effect.succeed(Option.fromNullishOr(opened.get(workspaceRoot)) as never),
            create: (input) =>
              Effect.sync(() => {
                const project = { id: input.projectId, workspaceRoot: input.workspaceRoot };
                opened.set(input.workspaceRoot, project);
                return project as never;
              }),
          }),
        ),
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
};

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

  it.effect("tells each run in plain words, and titles the notes it touched", () =>
    Effect.gen(function* () {
      const vault = yield* makeFolder({ vault: true });
      yield* vault.fs.makeDirectory(`${vault.root}/daily`);
      yield* vault.fs.makeDirectory(`${vault.root}/projects`);
      yield* vault.fs.writeFileString(
        `${vault.root}/daily/2026-11-15.md`,
        "---\ntags: [daily]\n---\n# Sunday 15 November\n\n- [ ] Call the notary\n- Pack for **Lisbon**\n",
      );
      yield* vault.fs.writeFileString(
        `${vault.root}/projects/lisbon.md`,
        "# Lisbon move\n\nFlats.\n",
      );
      yield* commitVaultRun({
        cwd: vault.root,
        message: vaultCommitMessage({ threadTitle: "Morning", runOrdinal: 2, threadId: "t-day" }),
      });
      yield* vault.fs.writeFileString(`${vault.root}/handover-2026-11-03.md`, "No heading\n");
      yield* commitVaultRun({
        cwd: vault.root,
        message: vaultCommitMessage({ threadTitle: "Old chat", runOrdinal: 1, threadId: "t-gone" }),
      });
      const service = yield* makeService(
        { [vaultProject]: vault.root },
        {
          "t-day": [
            { ordinal: 1, reply: "Earlier run." },
            {
              ordinal: 2,
              reply: "## Your day\n\nThree meetings; the visa appointment moved to **Thursday**.",
              scheduledTaskId: `majordome:${vaultProject}:start-my-day`,
            },
          ],
        },
      );

      const history = yield* service.listHistory({ projectId: vaultProject });
      assert.deepEqual(
        history.entries.map((entry) => [
          entry.subject,
          entry.summary ?? null,
          entry.routine ?? null,
          entry.dailyNotePreview ?? null,
        ]),
        [
          ["majordome: Old chat", null, null, null],
          [
            "majordome: Morning",
            "Three meetings; the visa appointment moved to Thursday.",
            "start-my-day",
            "• Call the notary\n• Pack for Lisbon",
          ],
          ["My first note", null, null, null],
        ],
      );
      assert.deepEqual(history.folders, { daily: "daily", inbox: "inbox" });
      assert.deepEqual(history.notes, {
        "handover-2026-11-03.md": null,
        "daily/2026-11-15.md": "Sunday 15 November",
        "projects/lisbon.md": "Lisbon move",
        "memory.md": null,
      });
    }),
  );

  it.effect("says which server runs the vault's routines without claiming it", () =>
    Effect.gen(function* () {
      const vault = yield* makeFolder({ vault: true });
      const runnerFile = `${vault.root}/.majordome/runner`;
      const service = yield* makeService({ [vaultProject]: vault.root });
      const history = service.listHistory({ projectId: vaultProject });
      const runner = history.pipe(Effect.map((result) => result.routinesRunner));

      assert.equal(yield* runner, "none");
      assert.isFalse(yield* vault.fs.exists(runnerFile));
      yield* vault.fs.writeFileString(runnerFile, "env-elsewhere\n");
      assert.equal(yield* runner, "another-server");
      // Only the runner says whether the routines can run.
      assert.isUndefined((yield* history).routinesStatus);
      yield* vault.fs.writeFileString(runnerFile, "env-here\n");
      assert.equal(yield* runner, "this-server");
      assert.deepEqual((yield* history).routinesStatus, { ready: false, reason: "no-provider" });

      // A memory note longer than conversations load is said, with whether a routine shortens it.
      assert.isUndefined((yield* history).memoryOverLimit);
      yield* vault.fs.writeFileString(`${vault.root}/memory.md`, "x".repeat(8_001));
      assert.deepEqual((yield* history).memoryOverLimit, { tidyRoutineOn: false });
    }),
  );

  it.effect("saves the limits on unattended runs in the vault's config, keeping the rest", () =>
    Effect.gen(function* () {
      const vault = yield* makeFolder({ vault: true });
      const config = `${vault.root}/.majordome/config.json`;
      yield* vault.fs.writeFileString(config, JSON.stringify({ folders: { inbox: "drop" } }));
      const service = yield* makeService({ [vaultProject]: vault.root });
      const limits = service
        .listHistory({ projectId: vaultProject })
        .pipe(Effect.map((history) => history.routineLimits));

      assert.deepEqual(yield* limits, { runMinutes: 20, runsPerDay: 20 });
      yield* service.setRoutineLimits({
        projectId: vaultProject,
        limits: { runMinutes: 45, runsPerDay: 5 },
      });
      assert.deepEqual(yield* limits, { runMinutes: 45, runsPerDay: 5 });
      assert.deepEqual(JSON.parse(yield* vault.fs.readFileString(config)), {
        folders: { inbox: "drop" },
        limits: { runMinutes: 45, runsPerDay: 5 },
      });

      // The owner's choice is saved at once, so the end of a run does not take it for the run's.
      yield* commitVaultRun({ cwd: vault.root, message: "majordome: Later" });
      assert.deepEqual(yield* limits, { runMinutes: 45, runsPerDay: 5 });

      // A config it can't read is left alone rather than replaced.
      yield* vault.fs.writeFileString(config, "{ not json");
      const failed = yield* Effect.flip(
        service.setRoutineLimits({
          projectId: vaultProject,
          limits: { runMinutes: 1, runsPerDay: 1 },
        }),
      );
      assert.equal(failed.message, "Could not save the limits.");
      assert.equal(yield* vault.fs.readFileString(config), "{ not json");
    }),
  );

  it.effect("starts notes in a new folder, once, and refuses the whole home folder", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-home-" });
      const service = yield* makeService({});
      const start = (folder: string | null) =>
        service.startNotes({ folder }).pipe(Effect.provideService(HostProcess.HomeDirectory, home));

      const refused = yield* Effect.flip(start(home));
      assert.include(refused.message, "more than notes");
      assert.isFalse(yield* fs.exists(`${home}/.majordome`));

      const first = yield* start(null);
      assert.equal(first.folder, `${home}/Majordome`);
      assert.isTrue(yield* fs.exists(`${home}/Majordome/.majordome/config.json`));
      assert.deepEqual(yield* start(first.folder), first);
    }),
  );

  it.effect("welcomes the owner of new notes once, and keeps the name they give", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-home-" });
      const folder = `${home}/Majordome`;
      yield* setUpNotesFolder(folder);
      const projectId = ProjectId.make("notes");
      const service = yield* makeService({ [projectId]: folder });
      const config = `${folder}/.majordome/config.json`;

      // New notes ask for the welcome, wherever they are opened from.
      assert.deepEqual(yield* service.welcome({ projectId }), { pending: true, name: null });
      assert.equal(JSON.parse(yield* fs.readFileString(config)).welcome, "pending");

      assert.deepEqual(yield* service.finishWelcome({ projectId, name: "  Ana  Costa " }), {
        pending: false,
        name: "Ana Costa",
      });
      assert.deepEqual(yield* service.welcome({ projectId }), {
        pending: false,
        name: "Ana Costa",
      });
      assert.include(yield* fs.readFileString(`${folder}/me.md`), "## Me\n- Name: Ana Costa\n");
      assert.isUndefined(JSON.parse(yield* fs.readFileString(config)).welcome);
      // Saved at once as the owner's, so the next run's save does not take it for its own.
      assert.equal(yield* gitIn(folder, ["status", "--porcelain"]), "");
      assert.equal(yield* gitIn(folder, ["log", "-1", "--format=%s"]), "Said hello");

      // Skipped with no name: the welcome ends and the name stays as it was.
      assert.deepEqual(yield* service.finishWelcome({ projectId, name: null }), {
        pending: false,
        name: "Ana Costa",
      });
      assert.equal(yield* gitIn(folder, ["log", "-1", "--format=%s"]), "Said hello");
    }),
  );

  it.effect("restores a backup into a new folder, and leaves nothing behind when it cannot", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const vault = yield* makeFolder({ vault: true });
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-home-" });
      const backups = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-backups-" });
      const work = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-work-" });
      const passphrase = "correct horse battery staple";
      yield* createVaultBundle({ cwd: vault.root, bundlePath: `${work}/vault.bundle` });
      yield* encryptFile({
        source: `${work}/vault.bundle`,
        target: `${backups}/majordome-notes-2026-11-15.age`,
        passphrase,
        scryptWorkFactor: 10,
      });
      yield* fs.writeFileString(`${backups}/majordome-notes-2026-11-01.age`, "an older copy");
      const service = yield* makeService({});
      const restore = (input: { source: string; passphrase: string; into?: string }) =>
        service
          .restoreNotes({ into: null, ...input })
          .pipe(Effect.provideService(HostProcess.HomeDirectory, home));

      const wrong = yield* Effect.flip(restore({ source: backups, passphrase: "not the one" }));
      assert.include(wrong.message, "passphrase does not open");
      assert.notInclude(JSON.stringify(wrong), "not the one");
      const notOurs = yield* Effect.flip(restore({ source: `${work}/vault.bundle`, passphrase }));
      assert.include(notOurs.message, "not a Majordome backup");
      const empty = yield* Effect.flip(restore({ source: work, passphrase }));
      assert.include(empty.message, "no Majordome backup");
      const nowhere = yield* Effect.flip(
        restore({ source: backups, passphrase, into: `${home}/missing` }),
      );
      assert.include(nowhere.message, "does not exist");
      assert.deepEqual(yield* fs.readDirectory(home), []);

      const first = yield* restore({ source: backups, passphrase });
      assert.equal(first.folder, `${home}/Majordome`);
      assert.equal(first.file, `${backups}/majordome-notes-2026-11-15.age`);
      assert.equal(yield* fs.readFileString(`${first.folder}/memory.md`), "- Likes tea\n");
      const git = yield* GitVcsDriver.GitVcsDriver;
      const inRestored = (args: ReadonlyArray<string>) =>
        git
          .execute({ operation: "test.restored", cwd: first.folder, args })
          .pipe(Effect.map((result) => result.stdout.trim()));
      assert.equal(
        yield* inRestored(["rev-list", "--max-parents=0", "HEAD"]),
        yield* vault.run(["rev-list", "--max-parents=0", "HEAD"]),
      );
      assert.equal(yield* inRestored(["remote"]), "");

      // The folder that is there is never written into: a second restore sits beside it.
      yield* fs.writeFileString(`${first.folder}/memory.md`, "- Likes coffee\n");
      const second = yield* restore({
        source: `${backups}/majordome-notes-2026-11-15.age`,
        passphrase,
        into: home,
      });
      assert.equal(second.folder, `${home}/Majordome 2`);
      assert.notEqual(second.projectId, first.projectId);
      assert.equal(yield* fs.readFileString(`${first.folder}/memory.md`), "- Likes coffee\n");
      assert.deepEqual((yield* fs.readDirectory(home)).toSorted(), ["Majordome", "Majordome 2"]);
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
          routinesRunner: "none",
        });
        assert.deepEqual(yield* service.undo({ projectId, commit }), { status: "not-found" });
        assert.deepEqual(yield* Stream.runCollect(service.changes({ projectId })), []);
      }
      assert.equal(yield* code.run(["rev-list", "--count", "HEAD"]), "1");
    }),
  );
});
