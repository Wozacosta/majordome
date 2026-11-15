import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, type ScheduledTask, ThreadId } from "@t3tools/contracts";
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
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as MajordomeRoutines from "./MajordomeRoutines.ts";

const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, {
  discard: true,
});

const task = (projectId: string) =>
  ({ id: "majordome:task", projectId: ProjectId.make(projectId) }) as ScheduledTask;

const gateFor = (roots: Record<string, string>) =>
  Effect.service(ScheduledTaskService.ScheduledTaskRunGate).pipe(
    Effect.provide(
      MajordomeRoutines.layerRunGate.pipe(
        Layer.provide(
          Layer.mergeAll(
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
      ),
    ),
  );

it.layer(NodeServices.layer)("the runner gate", (it) => {
  it.effect("lets only the vault's runner fire its scheduled routines", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const elsewhere = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-gate-" });
      yield* fs.makeDirectory(`${elsewhere}/.majordome`);
      yield* fs.writeFileString(`${elsewhere}/.majordome/runner`, "env-elsewhere\n");
      const here = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-gate-" });
      yield* fs.makeDirectory(`${here}/.majordome`);
      const code = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-gate-" });

      const gate = yield* gateFor({ elsewhere, here, code });
      assert.isFalse(yield* gate(task("elsewhere")));
      // An unclaimed vault becomes this server's.
      assert.isTrue(yield* gate(task("here")));
      assert.equal(yield* fs.readFileString(`${here}/.majordome/runner`), "env-here\n");
      // Projects that are not vaults, or not found, are not Majordome's to hold back.
      assert.isTrue(yield* gate(task("code")));
      assert.isTrue(yield* gate(task("missing")));
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
    const fs = yield* FileSystem.FileSystem;
    const vaultRoot = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-vault-" });
    yield* fs.makeDirectory(`${vaultRoot}/.majordome`);
    yield* fs.makeDirectory(`${vaultRoot}/drop`);
    yield* fs.writeFileString(
      `${vaultRoot}/.majordome/config.json`,
      JSON.stringify({ folders: { daily: "daily", inbox: "drop" } }),
    );
    // Another computer runs this vault's routines until they are moved here.
    yield* fs.writeFileString(`${vaultRoot}/.majordome/runner`, "env-elsewhere\n");
    const projectId = ProjectId.make("project-e2e");
    const vaultRow = {
      projectId,
      workspaceRoot: vaultRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5" },
    } as ProjectStore.ProjectRow;
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
                }),
                ServerSettings.ServerSettingsService.layerTest(),
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
                  // The digest run never ends in this test.
                  waitForThread: () => Effect.never,
                }),
                Layer.mock(SecretRequests.SecretRequests)({}),
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
        // Routines are set up on every server, but only the runner watches the inbox.
        const tasks = (yield* scheduledTasks.list()).tasks;
        assert.deepEqual(tasks.map((task) => task.title).toSorted(), [
          "Digest my inbox",
          "Review my week",
          "Start my day",
        ]);
        assert.isFalse(yield* Deferred.isDone(watching));

        const missing = yield* Effect.flip(service.runHere(ProjectId.make("missing")));
        assert.equal(missing.message, "That vault was not found.");
        yield* service.runHere(projectId).pipe(withWatchBackend);
        assert.equal(yield* fs.readFileString(`${vaultRoot}/.majordome/runner`), "env-here\n");
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
      }),
    );
  }).pipe(Effect.provide(Layer.merge(SqlitePersistence.layerMemory, NodeServices.layer))),
);
