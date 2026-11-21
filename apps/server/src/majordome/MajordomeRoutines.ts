/**
 * Keeps each vault project's routines going on this server: creates the default routines, watches
 * the inbox where this server is the vault's runner, and stops scheduled routines from firing
 * where it is not. Vaults are found at startup, when projects change, and every few minutes, which
 * also notices a `.majordome/` folder added later and a runner moved from another machine.
 */

import {
  type MajordomeAddReadyRoutineInput,
  type MajordomeReadyRoutinesResult,
  type ModelSelection,
  type ProjectId,
  type ScheduledTask,
  ScheduledTaskId,
  type ScheduledTaskUpsertInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
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
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  autoRoutineMode,
  ensureDefaultRoutines,
  routineLedgerPath,
  routineTaskId,
} from "./defaultRoutines.ts";
import { INBOX_QUIET_PERIOD, watchInbox } from "./inboxWatcher.ts";
import { planMemoryPass } from "./memoryPass.ts";
import { readMemoryPassState, writeMemoryPassState } from "./memoryPassState.ts";
import * as MajordomeBackup from "./MajordomeBackup.ts";
import * as MajordomePush from "./MajordomePush.ts";
import {
  decideRoutinesBlockedPush,
  routinesBlockedPush,
  type RoutinesBlockedWatch,
} from "./pushDecision.ts";
import { readyRoutines } from "./readyMade.ts";
import { readRoutinesStatus } from "./routinesStatus.ts";
import * as RoutineRunLedger from "./RoutineRunLedger.ts";
import { readVaultLayout, readVaultLimits, type VaultLayout } from "./vaultConfig.ts";
import { chooseVaultModel } from "./vaultModel.ts";
import { readVaultTopics } from "./vaultTopics.ts";
import * as VaultLock from "./VaultLock.ts";
import { isVaultRunner, moveVaultRunner, readVaultRunner } from "./vaultRunner.ts";

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
    /** The vault's routines, without reminders. */
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<ScheduledTask>, MajordomeRoutinesError>;
    /** Sends a routine's results to a conversation, or with null to one of its own. */
    readonly place: (input: {
      readonly routine: ScheduledTask;
      readonly threadId: ThreadId | null;
    }) => Effect.Effect<void, MajordomeRoutinesError>;
    /** The ready-made routines the vault does not have, for "New routine". */
    readonly ready: (
      projectId: ProjectId,
    ) => Effect.Effect<MajordomeReadyRoutinesResult, MajordomeRoutinesError>;
    /** Adds a ready-made routine, switched on, running like the default ones. */
    readonly addReady: (
      input: MajordomeAddReadyRoutineInput,
    ) => Effect.Effect<void, MajordomeRoutinesError>;
  }
>()("t3/majordome/MajordomeRoutines") {}

/** Stable per project, so a ready-made routine is offered again only once it is removed. */
const readyRoutineTaskId = (projectId: ProjectId, key: string) =>
  ScheduledTaskId.make(`majordome:${projectId}:ready:${key}`);

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
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const config = yield* ServerConfig.ServerConfig;
  const runLedger = yield* RoutineRunLedger.RoutineRunLedger;
  const backup = yield* MajordomeBackup.MajordomeBackup;
  const push = yield* MajordomePush.MajordomePush;
  const vaultLock = yield* VaultLock.VaultLock;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const services = yield* Effect.context<
    | FileSystem.FileSystem
    | Path.Path
    | ScheduledTaskService.ScheduledTaskService
    | GitVcsDriver.GitVcsDriver
  >();
  const layerScope = yield* Effect.scope;
  const ledgerPath = routineLedgerPath(path, config.stateDir);
  const reconcileLock = yield* Semaphore.make(1);
  const watchers = yield* Ref.make<ReadonlyMap<ProjectId, InboxWatcher>>(new Map());
  // Log a vault without a model once, not at every reconcile.
  const reportedNoModel = yield* Ref.make<ReadonlySet<ProjectId>>(new Set());
  const blockedWatches = yield* Ref.make<ReadonlyMap<ProjectId, RoutinesBlockedWatch>>(new Map());

  const chooseModel = (project: ProjectStore.ProjectRow) =>
    chooseVaultModel(project).pipe(
      Effect.provideService(ServerSettings.ServerSettingsService, settings),
      Effect.provideService(ThreadManagementService.ThreadManagementService, threads),
      Effect.provideService(ProviderRegistry.ProviderRegistry, providers),
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
    if (result === "created" || result === "added") {
      yield* Effect.logInfo(
        result === "created"
          ? "Majordome created a vault's default routines."
          : "Majordome added a new default routine to a vault.",
        { projectId: project.projectId },
      );
    } else if (result === "no-model") {
      const first = yield* Ref.modify(reportedNoModel, (reported) =>
        reported.has(project.projectId)
          ? [false, reported]
          : [true, new Set(reported).add(project.projectId)],
      );
      if (first) {
        yield* Effect.logInfo(
          "Majordome will create this vault's routines once a provider is ready to run them: sign in to one in Settings > Providers.",
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

  /** Tells the owner's devices once when this server, the vault's runner, can't run its routines. */
  const notifyIfBlocked = Effect.fn("MajordomeRoutines.notifyIfBlocked")(function* (
    projectId: ProjectId,
    runner: boolean,
  ) {
    const status = runner
      ? yield* readRoutinesStatus({ ledgerPath, projectId }).pipe(
          Effect.provide(services),
          Effect.provideService(ProviderRegistry.ProviderRegistry, providers),
        )
      : { ready: true };
    const { watch, notify } = decideRoutinesBlockedPush({
      previous: (yield* Ref.get(blockedWatches)).get(projectId),
      status,
      now: yield* Clock.currentTimeMillis,
    });
    yield* Ref.update(blockedWatches, (watches) => {
      const next = new Map(watches);
      if (watch === undefined) next.delete(projectId);
      else next.set(projectId, watch);
      return next;
    });
    if (!notify) return;
    yield* Effect.logWarning("Majordome's routines can't run on this server; telling the owner.", {
      projectId,
      reason: status.reason,
    });
    // Delivery waits on the network; the other vaults must not.
    yield* push
      .notifyAll(
        routinesBlockedPush({
          status,
          environmentId: yield* environment.getEnvironmentId,
          serverLabel: (yield* environment.getDescriptor).label,
        }),
      )
      .pipe(Effect.forkIn(layerScope));
  });

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
      const { runsPerDay } = yield* readVaultLimits(vaultRoot).pipe(Effect.provide(services));
      if (!(yield* runLedger.take(projectId, runsPerDay))) {
        return yield* Effect.logInfo("Majordome's routines are paused for today; no digest.", {
          projectId,
        });
      }
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
          const runner = yield* isRunner(vaultRoot);
          if (runner) {
            wanted.set(project.projectId, {
              vaultRoot,
              inboxPath: path.join(vaultRoot, layout.value.inboxFolder),
            });
          }
          yield* notifyIfBlocked(project.projectId, runner);
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
      yield* vaultLock.withLock(
        vaultRoot,
        moveVaultRunner({
          vaultRoot,
          environmentId: yield* environment.getEnvironmentId,
          serverLabel: (yield* environment.getDescriptor).label,
        }).pipe(Effect.provide(services)),
      );
      // The other server runs the routines too until the move reaches it, so it is sent now. A
      // failed send shows on the backup screen like any other.
      yield* backup.runCycle(vaultRoot).pipe(Effect.forkIn(layerScope));
      yield* reconcile;
    },
    Effect.mapError((cause) =>
      isMajordomeRoutinesError(cause)
        ? cause
        : new MajordomeRoutinesError({ message: "Could not move routines here.", cause }),
    ),
  );

  const routinesFailed = (cause: unknown) =>
    new MajordomeRoutinesError({ message: "The routines could not be read or saved.", cause });

  const list: MajordomeRoutines["Service"]["list"] = Effect.fn("MajordomeRoutines.list")(function* (
    projectId,
  ) {
    const { tasks } = yield* scheduledTasks.list();
    return tasks.filter((task) => task.projectId === projectId && task.schedule.type !== "once");
  }, Effect.mapError(routinesFailed));

  const place: MajordomeRoutines["Service"]["place"] = Effect.fn("MajordomeRoutines.place")(
    function* ({ routine, threadId }) {
      const save = (to: Pick<ScheduledTaskUpsertInput, "threadId" | "threadMode">) =>
        scheduledTasks.upsert({
          id: routine.id,
          requireExisting: true,
          title: routine.title,
          prompt: routine.prompt,
          enabled: routine.enabled,
          schedule: routine.schedule.type === "webhook" ? { type: "webhook" } : routine.schedule,
          projectId: routine.projectId,
          workspaceStrategy: routine.workspaceStrategy,
          modelSelection: routine.modelSelection,
          runtimeMode: routine.runtimeMode,
          interactionMode: routine.interactionMode,
          creationSource: routine.creationSource,
          ...to,
        });
      if (threadId !== null) return yield* save({ threadId, threadMode: "continue" });
      // A routine only leaves a conversation by opening one per run; then it keeps a new one.
      yield* save({ threadMode: "new_thread" });
      yield* save({ threadMode: "fresh_session" });
    },
    Effect.mapError(routinesFailed),
  );

  const readyFor = Effect.fn("MajordomeRoutines.readyFor")(function* (projectId: ProjectId) {
    const project = yield* projects.get(projectId);
    if (Option.isNone(project)) {
      return yield* new MajordomeRoutinesError({ message: "Those notes were not found." });
    }
    const vaultRoot = project.value.workspaceRoot;
    if (Option.isNone(yield* readVaultLayout(vaultRoot).pipe(Effect.provide(services)))) {
      return yield* new MajordomeRoutinesError({ message: "That folder is not a notes folder." });
    }
    const topics = yield* readVaultTopics(vaultRoot).pipe(Effect.provide(services));
    const taken = new Set((yield* scheduledTasks.list()).tasks.map((task) => task.id));
    return {
      project: project.value,
      routines: readyRoutines(topics).filter(
        ({ routine }) => !taken.has(readyRoutineTaskId(projectId, routine.key)),
      ),
    };
  });

  const ready: MajordomeRoutines["Service"]["ready"] = Effect.fn("MajordomeRoutines.ready")(
    function* (projectId) {
      const { routines } = yield* readyFor(projectId);
      return {
        routines: routines.map(({ routine, topic }) => ({
          key: routine.key,
          title: routine.title,
          description: routine.description,
          when: routine.when,
          ...(routine.needs === undefined ? {} : { needs: routine.needs }),
          ...(topic === null ? {} : { topicId: topic.id }),
        })),
      };
    },
    Effect.mapError((cause) => (isMajordomeRoutinesError(cause) ? cause : routinesFailed(cause))),
  );

  const addReady: MajordomeRoutines["Service"]["addReady"] = Effect.fn(
    "MajordomeRoutines.addReady",
  )(
    function* (input) {
      const { project, routines } = yield* readyFor(input.projectId);
      const found = routines.find(({ routine }) => routine.key === input.key);
      if (found === undefined) {
        return yield* new MajordomeRoutinesError({
          message: "That routine is already in your list, or its topic is not.",
        });
      }
      const runner = yield* readVaultRunner(project.workspaceRoot).pipe(Effect.provide(services));
      if (Option.isSome(runner) && runner.value !== (yield* environment.getEnvironmentId)) {
        return yield* new MajordomeRoutinesError({
          message: "Routines for these notes run on another of your computers. Add it from there.",
        });
      }
      const modelSelection = yield* chooseModel(project);
      if (modelSelection === null) {
        return yield* new MajordomeRoutinesError({
          message: "The assistant isn't set up yet, so it could not run this routine.",
        });
      }
      yield* scheduledTasks.upsert({
        id: readyRoutineTaskId(input.projectId, found.routine.key),
        title: found.routine.title,
        prompt: found.routine.prompt(found.topic?.folder ?? null),
        enabled: true,
        schedule: found.routine.schedule,
        projectId: input.projectId,
        ...(input.threadId === undefined
          ? { threadMode: "fresh_session" as const }
          : { threadId: input.threadId, threadMode: "continue" as const }),
        workspaceStrategy: { type: "root" },
        modelSelection,
        runtimeMode: (yield* autoMode(modelSelection)) ?? "auto-accept-edits",
        interactionMode: "default",
        createdBy: "user",
        creationSource: "server",
      });
    },
    Effect.mapError((cause) => (isMajordomeRoutinesError(cause) ? cause : routinesFailed(cause))),
  );

  return MajordomeRoutines.of({ start, runHere, list, place, ready, addReady });
});

export const layer = Layer.effect(MajordomeRoutines, make);

/**
 * Lets a scheduled task fire only on its vault's runner, and only while the vault has runs left
 * today. The memory pass is also held back, before it counts as a run, on a night with nothing new
 * to go through. Tasks outside vaults are not affected, and neither are manual runs or one-time
 * tasks: a reminder the owner asked for always fires, and does not count as a run.
 */
export const layerRunGate = Layer.effect(
  ScheduledTaskService.ScheduledTaskRunGate,
  Effect.gen(function* () {
    const projects = yield* ProjectStore.ProjectStoreV2;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const runLedger = yield* RoutineRunLedger.RoutineRunLedger;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const services = yield* Effect.context<
      FileSystem.FileSystem | Path.Path | GitVcsDriver.GitVcsDriver
    >();
    return (task) =>
      Effect.gen(function* () {
        const project = yield* projects.get(task.projectId);
        if (Option.isNone(project)) return true;
        const vaultRoot = project.value.workspaceRoot;
        const layout = yield* readVaultLayout(vaultRoot);
        if (Option.isNone(layout)) return true;
        // A reminder exists only on the server it was asked on, so no other server would fire it.
        if (task.schedule.type === "once") return true;
        const runner = yield* isVaultRunner({
          vaultRoot,
          environmentId: yield* environment.getEnvironmentId,
        });
        if (!runner) return false;
        const passKey = { stateDir, projectId: task.projectId };
        const pass =
          task.id === routineTaskId(task.projectId, "tidy-my-memory")
            ? yield* planMemoryPass({
                vaultRoot,
                layout: layout.value,
                previous: yield* readMemoryPassState(passKey),
                passTitle: task.title,
                now: yield* DateTime.now,
              })
            : undefined;
        if (pass === null) return false;
        const { runsPerDay } = yield* readVaultLimits(vaultRoot);
        const mayRun = yield* runLedger.take(task.projectId, runsPerDay);
        // Only a pass that runs moves on, so a night without runs left loses nothing.
        if (mayRun && pass !== undefined) yield* writeMemoryPassState(passKey, pass);
        return mayRun;
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

const REPEATING_ELSEWHERE =
  "Routines for these notes run on another of the owner's computers, so one set up or changed here would never run. Tell the owner, in plain words, to do this from the Routines screen, which talks to that computer. A one-time reminder works from here.";

/**
 * A routine the assistant sets up in a vault runs like the default ones: in the notes folder, with
 * the vault's model, in Auto where the provider allows it. A server that is not the vault's runner
 * refuses repeating ones, which its run gate would hold back for good.
 */
export const layerAgentTaskDefaults = Layer.effect(
  ScheduledTaskService.ScheduledTaskAgentDefaultsFor,
  Effect.gen(function* () {
    const projects = yield* ProjectStore.ProjectStoreV2;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const settings = yield* ServerSettings.ServerSettingsService;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    return (projectId) =>
      Effect.gen(function* () {
        const project = yield* projects.get(projectId);
        if (Option.isNone(project)) return Option.none();
        const vaultRoot = project.value.workspaceRoot;
        if (Option.isNone(yield* readVaultLayout(vaultRoot))) return Option.none();
        const modelSelection = yield* chooseVaultModel(project.value).pipe(
          Effect.provideService(ServerSettings.ServerSettingsService, settings),
          Effect.provideService(ThreadManagementService.ThreadManagementService, threads),
          Effect.provideService(ProviderRegistry.ProviderRegistry, providers),
        );
        const provider =
          modelSelection === null
            ? undefined
            : (yield* providers.getProviders).find(
                (candidate) => candidate.instanceId === modelSelection.instanceId,
              );
        const runner = yield* readVaultRunner(vaultRoot);
        const here = yield* environment.getEnvironmentId;
        return Option.some({
          modelSelection,
          runtimeMode: autoRoutineMode({
            supportedRuntimeModes: provider?.supportedRuntimeModes,
            maxRuntimeMode: settings.managedPolicy?.limits?.maxRuntimeMode,
          }),
          repeatingRefusal:
            Option.isSome(runner) && runner.value !== here ? REPEATING_ELSEWHERE : undefined,
        });
      }).pipe(
        Effect.provide(services),
        Effect.catchCause((cause) =>
          Effect.logWarning("Majordome could not read a vault's routine defaults.", {
            projectId,
            cause,
          }).pipe(Effect.as(Option.none())),
        ),
      );
  }),
);
