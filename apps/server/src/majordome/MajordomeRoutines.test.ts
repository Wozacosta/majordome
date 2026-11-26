import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type ScheduledTask,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as MajordomeBackup from "./MajordomeBackup.ts";
import * as MajordomePush from "./MajordomePush.ts";
import * as MajordomeRoutines from "./MajordomeRoutines.ts";
import { readMemoryPassState } from "./memoryPassState.ts";
import * as RoutineRunLedger from "./RoutineRunLedger.ts";
import * as VaultLock from "./VaultLock.ts";
import { commitAll, gitIn, makeVault } from "./vaultTestRepos.ts";

const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, {
  discard: true,
});

const task = (projectId: string, schedule: ScheduledTask["schedule"]["type"] = "fixed_time") =>
  ({
    id: "majordome:task",
    projectId: ProjectId.make(projectId),
    schedule: { type: schedule },
  }) as ScheduledTask;

const gateFor = (roots: Record<string, string>) =>
  Effect.all({
    gate: Effect.service(ScheduledTaskService.ScheduledTaskRunGate),
    stateDir: Effect.map(ServerConfig.ServerConfig, (config) => config.stateDir),
  }).pipe(
    Effect.provide(
      MajordomeRoutines.layerRunGate.pipe(
        Layer.provide(
          Layer.mergeAll(
            RoutineRunLedger.layer,
            GitVcsDriver.layer.pipe(Layer.provide(NodeCrypto.layer)),
            Layer.mock(ProjectStore.ProjectStoreV2)({
              get: (projectId) =>
                Effect.succeed(
                  roots[projectId] === undefined
                    ? Option.none()
                    : Option.some({ workspaceRoot: roots[projectId] } as ProjectStore.ProjectRow),
                ),
            }),
            Layer.mock(ServerEnvironment.ServerEnvironment)({
              getEnvironmentId: Effect.succeed(EnvironmentId.make("env-here")),
            }),
          ),
        ),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-gate-" })),
      ),
    ),
  );

const memoryPassTask = (projectId: string) =>
  ({
    id: `majordome:${projectId}:tidy-my-memory`,
    projectId: ProjectId.make(projectId),
    title: "Tidy my memory",
    schedule: { type: "fixed_time", timeOfDay: "03:30" },
  }) as ScheduledTask;

// The memory pass test builds its vaults with git.
const gateTestLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-gate-vaults-" })),
  Layer.provideMerge(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
);

const defaultsFor = (input: {
  readonly roots: Record<string, string>;
  readonly supportedRuntimeModes?: ServerProvider["supportedRuntimeModes"];
}) =>
  Effect.service(ScheduledTaskService.ScheduledTaskAgentDefaultsFor).pipe(
    Effect.provide(
      MajordomeRoutines.layerAgentTaskDefaults.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProjectStore.ProjectStoreV2)({
              get: (projectId) =>
                Effect.succeed(
                  input.roots[projectId] === undefined
                    ? Option.none()
                    : Option.some({
                        projectId,
                        workspaceRoot: input.roots[projectId],
                        defaultModelSelection: null,
                      } as unknown as ProjectStore.ProjectRow),
                ),
            }),
            Layer.mock(ServerEnvironment.ServerEnvironment)({
              getEnvironmentId: Effect.succeed(EnvironmentId.make("env-here")),
            }),
            Layer.mock(ServerSettings.ServerSettingsService)({
              getSettings: Effect.succeed({
                ...DEFAULT_SERVER_SETTINGS,
                defaultModelSelection: { instanceId: "claude", model: "sonnet" } as never,
              }),
            }),
            Layer.mock(ThreadManagementService.ThreadManagementService)({}),
            Layer.mock(ProviderRegistry.ProviderRegistry)({
              getProviders: Effect.succeed([
                {
                  instanceId: "claude",
                  supportedRuntimeModes: input.supportedRuntimeModes,
                } as unknown as ServerProvider,
              ]),
            }),
          ),
        ),
      ),
    ),
  );

it.layer(NodeServices.layer)("what the assistant's routines run with", (it) => {
  it.effect("gives a vault its model and Auto, and refuses repeating ones off the runner", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const here = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-defaults-" });
      yield* fs.makeDirectory(`${here}/.majordome`);
      const elsewhere = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-defaults-" });
      yield* fs.makeDirectory(`${elsewhere}/.majordome`);
      yield* fs.writeFileString(`${elsewhere}/.majordome/runner`, "env-elsewhere\n");
      const code = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-defaults-" });
      const roots = { here, elsewhere, code };

      const defaults = yield* defaultsFor({ roots });
      assert.deepEqual(Option.getOrThrow(yield* defaults(ProjectId.make("here"))), {
        modelSelection: { instanceId: "claude", model: "sonnet" } as never,
        runtimeMode: "auto",
        repeatingRefusal: undefined,
      });
      // Looking does not claim the vault for this server.
      assert.isFalse(yield* fs.exists(`${here}/.majordome/runner`));
      assert.include(
        Option.getOrThrow(yield* defaults(ProjectId.make("elsewhere"))).repeatingRefusal,
        "another of the owner's computers",
      );
      assert.isTrue(Option.isNone(yield* defaults(ProjectId.make("code"))));
      assert.isTrue(Option.isNone(yield* defaults(ProjectId.make("missing"))));

      const noAuto = yield* defaultsFor({ roots, supportedRuntimeModes: ["auto-accept-edits"] });
      assert.equal(
        Option.getOrThrow(yield* noAuto(ProjectId.make("here"))).runtimeMode,
        "auto-accept-edits",
      );
    }),
  );
});

it.layer(gateTestLayer)("the runner gate", (it) => {
  it.effect("lets only the vault's runner fire its scheduled routines", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const elsewhere = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-gate-" });
      yield* fs.makeDirectory(`${elsewhere}/.majordome`);
      yield* fs.writeFileString(`${elsewhere}/.majordome/runner`, "env-elsewhere\n");
      const here = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-gate-" });
      yield* fs.makeDirectory(`${here}/.majordome`);
      const code = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-gate-" });
      yield* fs.writeFileString(
        `${here}/.majordome/config.json`,
        JSON.stringify({ limits: { runsPerDay: 2 } }),
      );

      const { gate } = yield* gateFor({ elsewhere, here, code });
      assert.isFalse(yield* gate(task("elsewhere")));
      // A reminder is only on the server it was asked on, so it fires there.
      assert.isTrue(yield* gate(task("elsewhere", "once")));
      // An unclaimed vault becomes this server's.
      assert.isTrue(yield* gate(task("here")));
      assert.equal(yield* fs.readFileString(`${here}/.majordome/runner`), "env-here\n");
      // Then it fires until it has used today's runs.
      assert.isTrue(yield* gate(task("here")));
      assert.isFalse(yield* gate(task("here")));
      // A reminder still fires on a day without runs left.
      assert.isTrue(yield* gate(task("here", "once")));
      // Projects that are not vaults, or not found, are not Majordome's to hold back.
      assert.isTrue(yield* gate(task("code")));
      assert.isTrue(yield* gate(task("missing")));
    }),
  );

  it.effect("holds the memory pass back on a night with nothing new, without using a run", () =>
    Effect.gen(function* () {
      const { root: vault, fs } = yield* makeVault();
      yield* fs.writeFileString(
        `${vault}/.majordome/config.json`,
        JSON.stringify({ limits: { runsPerDay: 2 } }),
      );
      yield* fs.writeFileString(`${vault}/.majordome/runner`, "env-here\n");
      yield* fs.makeDirectory(`${vault}/daily`);
      yield* fs.writeFileString(`${vault}/daily/2026-11-15.md`, "- My accountant is Ana");
      yield* commitAll(vault, "Your edits");
      const { root: elsewhere } = yield* makeVault();
      yield* fs.writeFileString(`${elsewhere}/.majordome/runner`, "env-elsewhere\n");
      yield* fs.writeFileString(`${elsewhere}/note.md`, "- Something new");

      const { gate, stateDir } = yield* gateFor({ vault, elsewhere });
      const passState = (projectId: string) =>
        readMemoryPassState({ stateDir, projectId }).pipe(Effect.map(Option.getOrUndefined));

      // Another server runs that vault's routines: nothing is planned here.
      assert.isFalse(yield* gate(memoryPassTask("elsewhere")));
      assert.isUndefined(yield* passState("elsewhere"));

      assert.isTrue(yield* gate(memoryPassTask("vault")));
      assert.deepEqual((yield* passState("vault"))?.brief.files, ["daily/2026-11-15.md"]);
      // Nothing changed since: the pass is skipped, and the day's second run is still there.
      assert.isFalse(yield* gate(memoryPassTask("vault")));
      assert.isTrue(yield* gate(task("vault")));

      // Out of runs for today, the pass waits and keeps its place.
      yield* fs.writeFileString(`${vault}/daily/2026-11-16.md`, "- Stopped the gym in January");
      yield* commitAll(vault, "Your edits");
      assert.isFalse(yield* gate(memoryPassTask("vault")));
      assert.deepEqual((yield* passState("vault"))?.brief.files, ["daily/2026-11-15.md"]);
      yield* TestClock.adjust("1 day");
      assert.isTrue(yield* gate(memoryPassTask("vault")));
      assert.deepEqual((yield* passState("vault"))?.brief.files, ["daily/2026-11-16.md"]);
    }),
  );
});

const insertDueTask = (sql: SqlClient.SqlClient, now: string) =>
  sql`INSERT INTO scheduled_tasks ${sql.insert({
    task_id: "majordome:project-vault:start-my-day",
    title: "Start my day",
    prompt: "Run my morning routine.",
    enabled: 1,
    schedule_json: '{"type":"interval","everyMs":60000}',
    project_id: "project-vault",
    thread_id: null,
    workspace_strategy_json: '{"type":"root"}',
    model_selection_json: '{"instanceId":"codex","model":"gpt-5"}',
    runtime_mode: "auto-accept-edits",
    interaction_mode: "default",
    created_by: "system",
    creation_source: "server",
    created_at: now,
    updated_at: now,
    next_run_at: now,
    last_run_at: null,
    last_run_status: "never",
    last_run_error: null,
    run_count: 0,
  })}`;

it.effect("skips a scheduled occurrence the gate refuses and fires it once allowed", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const now = "2026-09-09T12:00:00.000Z";
    yield* insertDueTask(sql, now);
    yield* TestClock.setTime(Date.parse(now) + 1_000);

    const allowed = yield* Ref.make(false);
    const decisions = yield* Queue.unbounded<boolean>();
    const launched = yield* Deferred.make<void>();
    const launches = yield* Ref.make(0);
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(
          Layer.provideMerge(
            ScheduledTaskService.layer,
            Layer.mergeAll(
              Layer.succeed(ScheduledTaskService.ScheduledTaskRunGate, () =>
                Ref.get(allowed).pipe(Effect.tap((decision) => Queue.offer(decisions, decision))),
              ),
              ManagedPolicy.layerTest(),
              Layer.mock(ThreadLaunchService.ThreadLaunchService)({
                launch: () =>
                  Ref.update(launches, (n) => n + 1).pipe(
                    Effect.andThen(Deferred.succeed(launched, undefined)),
                    Effect.andThen(Effect.die(new Error("test launch"))),
                  ),
              }),
              Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
                namedProjectsRoot: "/projects",
                isScratchProject: () => Effect.succeed(false),
              }),
              Layer.mock(ThreadManagementService.ThreadManagementService)({}),
              Layer.mock(SecretRequests.SecretRequests)({}),
              NodeCrypto.layer,
              Scheduler.layer,
            ),
          ),
        );
        yield* TestClock.adjust("6 seconds");
        assert.isFalse(yield* Queue.take(decisions));
        yield* settle;
        const [skipped] = yield* sql<{
          next_run_at: string | null;
          last_run_status: string;
          run_count: number;
        }>`SELECT next_run_at, last_run_status, run_count FROM scheduled_tasks`;
        assert.equal(yield* Ref.get(launches), 0);
        assert.equal(skipped?.last_run_status, "never");
        assert.equal(skipped?.run_count, 0);
        assert.isTrue((skipped?.next_run_at ?? "") > now);

        yield* Ref.set(allowed, true);
        yield* TestClock.adjust("61 seconds");
        assert.isTrue(yield* Queue.take(decisions));
        yield* Deferred.await(launched);
        assert.equal(yield* Ref.get(launches), 1);
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("moves a vault's routines here and digests files dropped in its inbox", () =>
  Effect.gen(function* () {
    const { root: vaultRoot, fs } = yield* makeVault();
    yield* fs.makeDirectory(`${vaultRoot}/drop`);
    yield* fs.writeFileString(
      `${vaultRoot}/.majordome/config.json`,
      JSON.stringify({ folders: { daily: "daily", inbox: "drop" } }),
    );
    // Another computer runs this vault's routines until they are moved here.
    yield* fs.writeFileString(`${vaultRoot}/.majordome/runner`, "env-elsewhere\n");
    yield* commitAll(vaultRoot, "Your edits");
    const backedUp = yield* Deferred.make<string>();
    const projectId = ProjectId.make("project-e2e");
    // A fresh server: no default model and no threads, only a provider that is signed in.
    const vaultRow = { projectId, workspaceRoot: vaultRoot } as ProjectStore.ProjectRow;
    const claude = {
      instanceId: "claude",
      enabled: true,
      installed: true,
      status: "ready",
      models: [{ slug: "claude-opus-5-5", isDefault: true, isCustom: false }],
    } as unknown as ServerProvider;
    const launched = yield* Queue.unbounded<string>();
    // Inbox events come from this queue instead of the OS, so the test controls their timing.
    const watchEvents = yield* Queue.unbounded<FileSystem.WatchEvent>();
    const watching = yield* Deferred.make<string>();
    const watchBackend = FileSystem.WatchBackend.of({
      register: (path) => {
        Deferred.doneUnsafe(watching, Exit.succeed(path));
        return Option.some(Stream.fromQueue(watchEvents));
      },
    });

    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          MajordomeRoutines.layer.pipe(
            Layer.provideMerge(ScheduledTaskService.layer),
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(ProjectStore.ProjectStoreV2)({
                  list: () => Effect.succeed([vaultRow]),
                  get: (id) =>
                    Effect.succeed(id === projectId ? Option.some(vaultRow) : Option.none()),
                }),
                Layer.mock(OrchestrationEventStore.OrchestrationEventStore)({
                  latestApplicationSequence: Effect.succeed(0),
                  streamApplicationEvents: () => Stream.never,
                }),
                Layer.mock(ServerEnvironment.ServerEnvironment)({
                  getEnvironmentId: Effect.succeed(EnvironmentId.make("env-here")),
                  getDescriptor: Effect.succeed({ label: "vps" } as never),
                }),
                Layer.mock(MajordomeBackup.MajordomeBackup)({
                  runCycle: (root) => Deferred.succeed(backedUp, root).pipe(Effect.asVoid),
                }),
                Layer.mock(MajordomePush.MajordomePush)({ notifyAll: () => Effect.succeed(0) }),
                VaultLock.layer,
                ServerSettings.ServerSettingsService.layerTest(),
                RoutineRunLedger.layer.pipe(
                  Layer.provide(
                    ServerConfig.layerTest(process.cwd(), { prefix: "majordome-routines-" }),
                  ),
                ),
                ServerConfig.layerTest(process.cwd(), { prefix: "majordome-routines-" }),
                ManagedPolicy.layerTest(),
                Layer.mock(ThreadLaunchService.ThreadLaunchService)({
                  launch: (input) =>
                    Queue.offer(launched, input.title).pipe(
                      Effect.as({ threadId: ThreadId.make("thread-digest") } as never),
                    ),
                }),
                Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
                  namedProjectsRoot: "/projects",
                  isScratchProject: () => Effect.succeed(false),
                }),
                Layer.mock(ThreadManagementService.ThreadManagementService)({
                  listProjectThreads: () => Effect.succeed([]),
                  getThreadShell: () =>
                    Effect.succeed({ projectId, deletedAt: null, archivedAt: null } as never),
                  // The digest run never ends in this test.
                  waitForThread: () => Effect.never,
                }),
                Layer.mock(SecretRequests.SecretRequests)({}),
                Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
                  getInstance: () => Effect.undefined,
                }),
                Layer.mock(ProviderRegistry.ProviderRegistry)({
                  getProviders: Effect.succeed([claude]),
                }),
                NodeCrypto.layer,
                Scheduler.layer,
              ),
            ),
          ),
        );
        const service = Context.get(context, MajordomeRoutines.MajordomeRoutines);
        const scheduledTasks = Context.get(context, ScheduledTaskService.ScheduledTaskService);
        const withWatchBackend = Effect.provideService(FileSystem.WatchBackend, watchBackend);
        yield* service.start().pipe(withWatchBackend);
        yield* settle;
        yield* TestClock.adjust("1 second");
        yield* settle;
        // Only the runner watches the inbox.
        assert.isFalse(yield* Deferred.isDone(watching));

        yield* fs.writeFileString(
          `${vaultRoot}/.majordome/topics.json`,
          JSON.stringify({ topics: [{ id: "bills", title: "Bills", folder: "projects/money" }] }),
        );
        const offered = (yield* service.ready(projectId)).routines;
        assert.deepInclude(
          offered.find((routine) => routine.key === "money"),
          { title: "Bills due soon", topicId: "bills" },
        );
        // A topic the owner does not have brings no routine; ones without a topic are always there.
        assert.isUndefined(offered.find((routine) => routine.key === "meals"));
        assert.equal(offered.find((routine) => routine.key === "inbox-summary")?.needs, "Gmail");
        assert.includeMembers(
          offered.map((routine) => routine.key),
          ["note-to-reread", "todos-left-behind"],
        );
        const elsewhere = yield* Effect.flip(service.addReady({ projectId, key: "money" }));
        assert.include(elsewhere.message, "another of your computers");

        const missing = yield* Effect.flip(service.runHere(ProjectId.make("missing")));
        assert.equal(missing.message, "That vault was not found.");
        yield* service.runHere(projectId).pipe(withWatchBackend);
        // The move checks the vault's routines before it returns.
        const tasks = (yield* scheduledTasks.list()).tasks;
        assert.deepEqual(tasks.map((task) => task.title).toSorted(), [
          "Digest my inbox",
          "Review my week",
          "Start my day",
          "Tidy my memory",
        ]);
        assert.equal(yield* fs.readFileString(`${vaultRoot}/.majordome/runner`), "env-here\n");

        yield* service.addReady({
          projectId,
          key: "money",
          threadId: ThreadId.make("thread-bills"),
        });
        yield* service.addReady({ projectId, key: "evening-journal" });
        const added = (yield* scheduledTasks.list()).tasks;
        const money = added.find((task) => task.title === "Bills due soon");
        assert.deepInclude(money, {
          enabled: true,
          threadId: ThreadId.make("thread-bills"),
          threadMode: "continue",
          schedule: { type: "fixed_time", timeOfDay: "08:30", weekdays: [1] },
        });
        assert.include(money?.prompt, "`projects/money/`");
        assert.equal(
          added.find((task) => task.title === "Evening journal prompt")?.threadMode,
          "fresh_session",
        );
        // Once added it is no longer offered, and asking again adds no second one.
        assert.notIncludeMembers(
          (yield* service.ready(projectId)).routines.map((routine) => routine.key),
          ["money", "evening-journal"],
        );
        const twice = yield* Effect.flip(service.addReady({ projectId, key: "money" }));
        assert.include(twice.message, "already in your list");
        // Committed and sent at once, so the other computer stops running them.
        assert.equal(
          yield* gitIn(vaultRoot, ["log", "-1", "--format=%an|%s"]),
          "Majordome|majordome: Routines run on vps",
        );
        assert.equal(yield* Deferred.await(backedUp), vaultRoot);
        assert.equal(yield* Deferred.await(watching), `${vaultRoot}/drop`);

        yield* fs.writeFileString(`${vaultRoot}/drop/receipt.md`, "Paid 12 EUR\n");
        yield* Queue.offer(watchEvents, { _tag: "Create", path: "receipt.md" });
        yield* Queue.offer(watchEvents, { _tag: "Create", path: ".hidden" });
        yield* settle;
        yield* TestClock.adjust("119 seconds");
        yield* settle;
        assert.equal(yield* Queue.size(launched), 0);
        yield* TestClock.adjust("2 seconds");
        assert.equal(yield* Queue.take(launched), "Digest my inbox");

        // Told that another computer runs them, this copy says so and this server steps down.
        const itself = yield* Effect.flip(
          service.runElsewhere({
            projectId,
            environmentId: EnvironmentId.make("env-here"),
            label: "vps",
          }),
        );
        assert.include(itself.message, "this computer");
        yield* service
          .runElsewhere({
            projectId,
            environmentId: EnvironmentId.make("env-other"),
            label: "Majordome server",
          })
          .pipe(withWatchBackend);
        assert.equal(yield* fs.readFileString(`${vaultRoot}/.majordome/runner`), "env-other\n");
        assert.equal(
          yield* gitIn(vaultRoot, ["log", "-1", "--format=%an|%s"]),
          "Majordome|majordome: Routines run on Majordome server",
        );
        const afterwards = yield* Effect.flip(
          service.addReady({ projectId, key: "inbox-summary" }),
        );
        assert.include(afterwards.message, "another of your computers");
      }),
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(SqlitePersistence.layerMemory, GitVcsDriver.layer).pipe(
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-git-" })),
        Layer.provideMerge(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
      ),
    ),
  ),
);
