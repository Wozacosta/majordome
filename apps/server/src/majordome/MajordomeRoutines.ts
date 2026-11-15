/**
 * Keeps each vault project's routines going on this server: creates the default routines, watches
 * the inbox where this server is the vault's runner, and stops scheduled routines from firing
 * where it is not. Vaults are found at startup, when projects change, and every few minutes, which
 * also notices a `.majordome/` folder added later and a runner moved from another machine.
 */

import { type ModelSelection, type ProjectId, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import { autoRoutineMode, ensureDefaultRoutines, routineTaskId } from "./defaultRoutines.ts";
import { INBOX_QUIET_PERIOD, watchInbox } from "./inboxWatcher.ts";
import { readVaultLayout, type VaultLayout } from "./vaultConfig.ts";
import { chooseVaultModel } from "./vaultModel.ts";
import { isVaultRunner, writeVaultRunner } from "./vaultRunner.ts";

const RECONCILE_INTERVAL = Duration.minutes(5);
const MISSING_INBOX_RETRY = Duration.minutes(1);
/** Approvals wait up to a day, so a digest run can too. */
const DIGEST_RUN_WAIT_MS = 24 * 60 * 60 * 1_000;

export class MajordomeRoutinesError extends Schema.TaggedError<MajordomeRoutinesError>()(
  "MajordomeRoutinesError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

const isMajordomeRoutinesError = Schema.is(MajordomeRoutinesError);

export class MajordomeRoutines extends Context.Service<
  MajordomeRoutines,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Makes this server the vault's runner, for "Move routines here". */
    readonly runHere: (projectId: ProjectId) => Effect.Effect<void, MajordomeRoutinesError>;
  }
>()("t3/majordome/MajordomeRoutines") {}

const backoff = Schedule.exponential("5 seconds").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.minutes(10))),
  ),
);

interface InboxWatcher {
  readonly inboxPath: string;
  readonly scope: Scope.Closeable;
}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const events = yield* OrchestrationEventStore.OrchestrationEventStore;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const services = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ScheduledTaskService.ScheduledTaskService
  >();
  const layerScope = yield* Effect.scope;
  const ledgerPath = path.join(config.stateDir, "majordome", "routines.json");
  const reconcileLock = yield* Semaphore.make(1);
  const watchers = yield* Ref.make<ReadonlyMap<ProjectId, InboxWatcher>>(new Map());
  // Log a vault without a model once, not at every reconcile.
  const reportedNoModel = yield* Ref.make<ReadonlySet<ProjectId>>(new Set());

  const chooseModel = (project: ProjectStore.ProjectRow) =>
    chooseVaultModel(project).pipe(
      Effect.provideService(ServerSettings.ServerSettingsService, settings),
      Effect.provideService(ThreadManagementService.ThreadManagementService, threads),
    );

  /** Null while the model's provider isn't registered, so the routines' mode waits for it. */
  const autoMode = Effect.fn("MajordomeRoutines.autoMode")(function* (
    modelSelection: ModelSelection,
  ) {
    const instance = yield* providerInstances.getInstance(modelSelection.instanceId);
    if (instance === undefined) return null;
    return autoRoutineMode({
      supportedRuntimeModes: (yield* instance.snapshot.getSnapshot).supportedRuntimeModes,
      maxRuntimeMode: settings.managedPolicy?.limits?.maxRuntimeMode,
    });
  });

  const setUpRoutines = Effect.fn("MajordomeRoutines.setUpRoutines")(function* (
    project: ProjectStore.ProjectRow,
    layout: VaultLayout,
  ) {
    const result = yield* ensureDefaultRoutines({
      ledgerPath,
      projectId: project.projectId,
      layout,
      modelSelection: chooseModel(project),
      autoMode,
    }).pipe(Effect.provide(services));
    if (result === "created") {
      yield* Effect.logInfo("Majordome created a vault's default routines.", {
        projectId: project.projectId,
      });
    } else if (result === "no-model") {
      const first = yield* Ref.modify(reportedNoModel, (reported) =>
        reported.has(project.projectId)
          ? [false, reported]
          : [true, new Set(reported).add(project.projectId)],
      );
      if (first) {
        yield* Effect.logInfo(
          "Majordome will create this vault's routines once it has a model to run them: set a default model or start a thread.",
          { projectId: project.projectId },
        );
      }
    }
  });

  const isRunner = (vaultRoot: string) =>
    environment.getEnvironmentId.pipe(
      Effect.flatMap((environmentId) => isVaultRunner({ vaultRoot, environmentId })),
      Effect.provide(services),
    );

  const awaitRunEnd = (projectId: ProjectId, threadId: ThreadId) =>
    threads.waitForThread({ projectId, threadId, timeoutMs: DIGEST_RUN_WAIT_MS }).pipe(
      // A thread can be launched a moment before its run is recorded.
      Effect.flatMap((result) =>
        result.run === null
          ? Effect.fail(new MajordomeRoutinesError({ message: "The digest run has not started." }))
          : Effect.void,
      ),
      Effect.retry({ times: 30, schedule: Schedule.spaced("1 second") }),
    );

  const digest = Effect.fn("MajordomeRoutines.digest")(
    function* (projectId: ProjectId, vaultRoot: string) {
      // The runner may have moved since the watch started.
      if (!(yield* isRunner(vaultRoot))) return;
      const { threadId } = yield* scheduledTasks.runNow({
        id: routineTaskId(projectId, "digest-my-inbox"),
      });
      if (threadId !== null) yield* awaitRunEnd(projectId, threadId);
    },
    (effect, projectId) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logInfo("Majordome did not digest the inbox.", { projectId, cause }),
        ),
      ),
  );

  // Runs as long as the watch is wanted, so tracing would leave a span open indefinitely.
  const watchLoop = Effect.fnUntraced(
    function* (projectId: ProjectId, vaultRoot: string, inboxPath: string) {
      const exists = yield* fileSystem.exists(inboxPath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return yield* Effect.sleep(MISSING_INBOX_RETRY);
      yield* Effect.scoped(
        watchInbox({
          events: fileSystem.watch(inboxPath, { recursive: true }),
          quietPeriod: INBOX_QUIET_PERIOD,
          isPresent: (relativePath) =>
            fileSystem
              .exists(path.join(inboxPath, relativePath))
              .pipe(Effect.orElseSucceed(() => false)),
          digest: digest(projectId, vaultRoot),
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Majordome's inbox watch stopped; it restarts shortly.", {
            projectId,
            cause,
          }),
        ),
      );
      yield* Effect.sleep(MISSING_INBOX_RETRY);
    },
    (loop) => Effect.forever(loop),
  );

  const reconcile = reconcileLock.withPermits(1)(
    Effect.gen(function* () {
      const wanted = new Map<
        ProjectId,
        { readonly vaultRoot: string; readonly inboxPath: string }
      >();
      for (const project of yield* projects.list()) {
        yield* Effect.gen(function* () {
          const vaultRoot = project.workspaceRoot;
          const layout = yield* readVaultLayout(vaultRoot).pipe(Effect.provide(services));
          if (Option.isNone(layout)) return;
          yield* setUpRoutines(project, layout.value);
          if (yield* isRunner(vaultRoot)) {
            wanted.set(project.projectId, {
              vaultRoot,
              inboxPath: path.join(vaultRoot, layout.value.inboxFolder),
            });
          }
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Majordome could not set up a vault's routines.", {
              projectId: project.projectId,
              cause,
            }),
          ),
        );
      }

      const current = yield* Ref.get(watchers);
      const next = new Map(current);
      for (const [projectId, watcher] of current) {
        if (wanted.get(projectId)?.inboxPath === watcher.inboxPath) continue;
        yield* Scope.close(watcher.scope, Exit.void);
        next.delete(projectId);
      }
      for (const [projectId, target] of wanted) {
        if (next.has(projectId)) continue;
        const scope = yield* Scope.fork(layerScope);
        yield* watchLoop(projectId, target.vaultRoot, target.inboxPath).pipe(Effect.forkIn(scope));
        next.set(projectId, { inboxPath: target.inboxPath, scope });
      }
      yield* Ref.set(watchers, next);
    }),
  );

  // Read the cursor before subscribing, so a project change in between is not missed.
  const projectChanges = Stream.unwrap(
    Effect.map(events.latestApplicationSequence, (afterSequence) =>
      events.streamApplicationEvents({ afterSequence }),
    ),
  ).pipe(
    Stream.filter(
      (stored) =>
        "type" in stored &&
        (stored.type === "project.created" ||
          stored.type === "project.meta-updated" ||
          stored.type === "project.deleted"),
    ),
    Stream.tapCause((cause) =>
      Effect.logWarning("Majordome's project event stream failed.", { cause }),
    ),
    Stream.retry(backoff),
  );
  // A default model chosen later lets routines be created.
  const settingsChanges = Stream.unwrap(settings.subscribeChanges);

  const start: MajordomeRoutines["Service"]["start"] = Effect.fn("MajordomeRoutines.start")(
    function* () {
      yield* forkParked(
        Stream.mergeAll(
          [
            Stream.tick(RECONCILE_INTERVAL),
            Stream.map(projectChanges, () => undefined),
            Stream.map(settingsChanges, () => undefined),
          ],
          { concurrency: "unbounded" },
        ).pipe(
          Stream.debounce(Duration.seconds(1)),
          Stream.runForEach(() =>
            reconcile.pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Majordome could not check vault routines.", { cause }),
              ),
            ),
          ),
        ),
      );
    },
  );

  const runHere: MajordomeRoutines["Service"]["runHere"] = Effect.fn("MajordomeRoutines.runHere")(
    function* (projectId) {
      const project = yield* projects.get(projectId);
      if (Option.isNone(project)) {
        return yield* new MajordomeRoutinesError({ message: "That vault was not found." });
      }
      const vaultRoot = project.value.workspaceRoot;
      const layout = yield* readVaultLayout(vaultRoot).pipe(Effect.provide(services));
      if (Option.isNone(layout)) {
        return yield* new MajordomeRoutinesError({ message: "That project is not a vault." });
      }
      yield* writeVaultRunner({
        vaultRoot,
        environmentId: yield* environment.getEnvironmentId,
      }).pipe(Effect.provide(services));
      yield* reconcile;
    },
    Effect.mapError((cause) =>
      isMajordomeRoutinesError(cause)
        ? cause
        : new MajordomeRoutinesError({ message: "Could not move routines here.", cause }),
    ),
  );

  return MajordomeRoutines.of({ start, runHere });
});

export const layer = Layer.effect(MajordomeRoutines, make);

/**
 * Lets a scheduled task fire only on its vault's runner. Tasks outside vaults are not affected,
 * and neither are manual runs.
 */
export const layerRunGate = Layer.effect(
  ScheduledTaskService.ScheduledTaskRunGate,
  Effect.gen(function* () {
    const projects = yield* ProjectStore.ProjectStoreV2;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    return (task) =>
      Effect.gen(function* () {
        const project = yield* projects.get(task.projectId);
        if (Option.isNone(project)) return true;
        const vaultRoot = project.value.workspaceRoot;
        if (Option.isNone(yield* readVaultLayout(vaultRoot))) return true;
        return yield* isVaultRunner({
          vaultRoot,
          environmentId: yield* environment.getEnvironmentId,
        });
      }).pipe(
        Effect.provide(services),
        Effect.catchCause((cause) =>
          Effect.logWarning("Majordome could not check a routine's runner; it runs here.", {
            taskId: task.id,
            cause,
          }).pipe(Effect.as(true)),
        ),
      );
  }),
);
