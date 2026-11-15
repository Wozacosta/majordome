import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { type ModelSelection, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import { ensureDefaultRoutines, routineTaskId } from "./defaultRoutines.ts";

const testLayer = ScheduledTaskService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      ManagedPolicy.layerTest(),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    ),
  ),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(NodeServices.layer),
);

const model: ModelSelection = { instanceId: "codex", model: "gpt-5.4" } as ModelSelection;
const layout = { memory: "memory.md", dailyFolder: "daily", inboxFolder: "drop" };

const setUp = Effect.fn("test.setUp")(function* (ledgerPath: string, projectId: ProjectId) {
  return yield* ensureDefaultRoutines({
    ledgerPath,
    projectId,
    layout,
    modelSelection: Effect.succeed(model),
  });
});

const makeLedgerPath = Effect.fn("test.makeLedgerPath")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-routines-" });
  return `${stateDir}/majordome/routines.json`;
});

it.layer(testLayer)("default routines", (it) => {
  it.effect("creates the three routines once", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-created-once");
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const ledgerPath = yield* makeLedgerPath();

      assert.equal(yield* setUp(ledgerPath, projectId), "created");
      const tasks = (yield* service.list()).tasks.filter((task) => task.projectId === projectId);
      assert.deepEqual(tasks.map((task) => task.title).toSorted(), [
        "Digest my inbox",
        "Review my week",
        "Start my day",
      ]);
      const byTitle = new Map(tasks.map((task) => [task.title, task]));
      const startMyDay = byTitle.get("Start my day");
      assert.isTrue(startMyDay?.enabled);
      assert.deepEqual(startMyDay?.schedule, { type: "fixed_time", timeOfDay: "08:00" });
      assert.equal(startMyDay?.runtimeMode, "auto-accept-edits");
      assert.equal(startMyDay?.threadMode, "new_thread");
      assert.equal(startMyDay?.createdBy, "system");
      assert.equal(startMyDay?.creationSource, "server");
      assert.deepEqual(startMyDay?.modelSelection, model);
      assert.deepEqual(byTitle.get("Review my week")?.schedule, {
        type: "fixed_time",
        timeOfDay: "18:00",
        weekdays: [0],
      });
      const digest = byTitle.get("Digest my inbox");
      assert.equal(digest?.id, routineTaskId(projectId, "digest-my-inbox"));
      assert.isFalse(digest?.enabled);
      assert.isNull(digest?.nextRunAt);
      assert.include(digest?.prompt ?? "", "`drop/`");

      assert.equal(yield* setUp(ledgerPath, projectId), "exists");
      assert.equal(
        (yield* service.list()).tasks.filter((task) => task.projectId === projectId).length,
        3,
      );
    }),
  );

  it.effect("does not bring back a routine the user deleted or overwrite an edit", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-user-edits");
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const ledgerPath = yield* makeLedgerPath();
      assert.equal(yield* setUp(ledgerPath, projectId), "created");

      yield* service.delete({ id: routineTaskId(projectId, "review-my-week") });
      assert.equal(yield* setUp(ledgerPath, projectId), "exists");
      const ids = (yield* service.list()).tasks.map((task) => task.id);
      assert.notInclude(ids, routineTaskId(projectId, "review-my-week"));
      assert.include(ids, routineTaskId(projectId, "start-my-day"));

      // A ledger lost after a partial setup keeps what already exists.
      yield* (yield* FileSystem.FileSystem).remove(ledgerPath);
      const startMyDay = routineTaskId(projectId, "start-my-day");
      const existing = (yield* service.list()).tasks.find((task) => task.id === startMyDay);
      assert.isDefined(existing);
      yield* service.setEnabled({ id: startMyDay, enabled: false });
      assert.equal(yield* setUp(ledgerPath, projectId), "created");
      const after = (yield* service.list()).tasks.find((task) => task.id === startMyDay);
      assert.isFalse(after?.enabled);
    }),
  );

  it.effect("waits for a model before creating anything", () =>
    Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const ledgerPath = yield* makeLedgerPath();
      const otherProject = ProjectId.make("project-no-model");
      const result = yield* ensureDefaultRoutines({
        ledgerPath,
        projectId: otherProject,
        layout,
        modelSelection: Effect.succeed(null),
      });
      assert.equal(result, "no-model");
      assert.isFalse((yield* service.list()).tasks.some((task) => task.projectId === otherProject));
      assert.isFalse(yield* (yield* FileSystem.FileSystem).exists(ledgerPath));
    }),
  );
});
