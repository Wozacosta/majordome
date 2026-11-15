/**
 * Stops a run a routine or the inbox started once it has worked past its vault's time limit (time
 * waiting for the owner doesn't count), and tells the owner it couldn't finish. Also tells them
 * once when routines pause for the day (`RoutineRunLedger`).
 */

import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type ProjectId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as MajordomePush from "./MajordomePush.ts";
import { makePushDedupe } from "./pushDecision.ts";
import * as RoutineRunLedger from "./RoutineRunLedger.ts";
import { readVaultLayout, readVaultLimits } from "./vaultConfig.ts";

export interface LimitedRun {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly title: string;
  readonly runMinutes: number;
}

interface TrackedRun {
  readonly run: LimitedRun;
  readonly leftMs: number;
  /** When the timer started, while one runs. */
  readonly armedAt: number | null;
  readonly timer: Fiber.Fiber<void> | null;
  readonly token: number;
  readonly openRequests: ReadonlySet<string>;
}

/**
 * Times runs and calls `stop` for one that works `runMinutes`. A pending question or approval
 * pauses its clock until every one is answered. Timers live in the caller's scope.
 */
export const makeRunTimeLimit = Effect.fn("majordome.makeRunTimeLimit")(function* (
  stop: (run: LimitedRun) => Effect.Effect<void>,
) {
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const tracked = yield* Ref.make<ReadonlyMap<ThreadId, TrackedRun>>(new Map());
  const nextToken = yield* Ref.make(0);

  const set = (threadId: ThreadId, entry: TrackedRun | null) =>
    Ref.update(tracked, (current) => {
      const next = new Map(current);
      if (entry === null) next.delete(threadId);
      else next.set(threadId, entry);
      return next;
    });

  const expire = (threadId: ThreadId, token: number) =>
    lock
      .withPermits(1)(
        Effect.gen(function* () {
          const entry = (yield* Ref.get(tracked)).get(threadId);
          if (entry?.token !== token) return null;
          yield* set(threadId, null);
          return entry.run;
        }),
      )
      .pipe(Effect.flatMap((run) => (run === null ? Effect.void : stop(run))));

  /** Starts the entry's clock with what it has left. Runs under the lock. */
  const arm = Effect.fnUntraced(function* (entry: Omit<TrackedRun, "armedAt" | "timer" | "token">) {
    const token = yield* Ref.updateAndGet(nextToken, (value) => value + 1);
    const timer = yield* Effect.sleep(entry.leftMs).pipe(
      Effect.andThen(expire(entry.run.threadId, token)),
      Effect.forkIn(scope),
    );
    yield* set(entry.run.threadId, {
      ...entry,
      armedAt: yield* Clock.currentTimeMillis,
      timer,
      token,
    });
  });

  const started = (run: LimitedRun) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const existing = (yield* Ref.get(tracked)).get(run.threadId);
        if (existing?.run.runId === run.runId) return;
        if (existing?.timer) yield* Fiber.interrupt(existing.timer);
        yield* arm({ run, leftMs: run.runMinutes * 60_000, openRequests: new Set() });
      }),
    );

  const request = (threadId: ThreadId, requestId: string, open: boolean) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const entry = (yield* Ref.get(tracked)).get(threadId);
        if (entry === undefined) return;
        const openRequests = new Set(entry.openRequests);
        if (open) openRequests.add(requestId);
        else openRequests.delete(requestId);
        if (openRequests.size > 0 && entry.timer !== null) {
          yield* Fiber.interrupt(entry.timer);
          const now = yield* Clock.currentTimeMillis;
          return yield* set(threadId, {
            ...entry,
            leftMs: Math.max(0, entry.leftMs - (now - (entry.armedAt ?? now))),
            armedAt: null,
            timer: null,
            openRequests,
          });
        }
        if (openRequests.size === 0 && entry.timer === null) {
          return yield* arm({ run: entry.run, leftMs: entry.leftMs, openRequests });
        }
        yield* set(threadId, { ...entry, openRequests });
      }),
    );

  const ended = (threadId: ThreadId, runId: RunId) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const entry = (yield* Ref.get(tracked)).get(threadId);
        if (entry?.run.runId !== runId) return;
        if (entry.timer !== null) yield* Fiber.interrupt(entry.timer);
        yield* set(threadId, null);
      }),
    );

  return { started, request, ended };
});

export class RoutineLimits extends Context.Service<
  RoutineLimits,
  { readonly start: () => Effect.Effect<void, never, Scope.Scope> }
>()("t3/majordome/RoutineLimits") {}

const threadUrl = (environmentId: string, threadId: ThreadId) =>
  `/threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const push = yield* MajordomePush.MajordomePush;
  const ledger = yield* RoutineRunLedger.RoutineRunLedger;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const firstTime = makePushDedupe();

  /** The run's vault and limit when a routine or the inbox started it in a vault, else null. */
  const limitedRun = Effect.fn("RoutineLimits.limitedRun")(function* (
    threadId: ThreadId,
    run: OrchestrationV2Run,
  ) {
    const message = (yield* threads.getMessagesById(threadId, [run.userMessageId])).get(
      run.userMessageId,
    );
    if (message?.scheduledTaskId === undefined) return null;
    const shell = yield* threads.getThreadShell(threadId);
    if (shell === null) return null;
    const project = Option.getOrUndefined(yield* projects.get(shell.projectId));
    if (project === undefined) return null;
    if (Option.isNone(yield* readVaultLayout(project.workspaceRoot))) return null;
    const { runMinutes } = yield* readVaultLimits(project.workspaceRoot);
    return {
      projectId: project.projectId,
      threadId,
      runId: run.id,
      title: shell.title.trim() || "A routine",
      runMinutes,
    } satisfies LimitedRun;
  });

  const stop = Effect.fn("RoutineLimits.stop")(
    function* (run: LimitedRun) {
      const minutes = `${run.runMinutes} ${run.runMinutes === 1 ? "minute" : "minutes"}`;
      const result = yield* threads.interruptThread({
        projectId: run.projectId,
        commandId: CommandId.make(`majordome:time-limit:${run.runId}`),
        threadId: run.threadId,
        runId: run.runId,
        reason: `Stopped after ${minutes}, the time limit for routines. You can change it in Routines.`,
      });
      if (result.type !== "interrupt_requested") return;
      yield* Effect.logInfo("Majordome stopped a routine that ran too long.", {
        threadId: run.threadId,
      });
      yield* ledger.recordStopped(run.projectId, run);
      yield* push.notifyAll({
        title: "Couldn't finish",
        body: `${run.title} was stopped after ${minutes}.`,
        tag: `majordome:${run.threadId}`,
        url: threadUrl(yield* environment.getEnvironmentId, run.threadId),
      });
    },
    (effect, run) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Majordome could not stop a routine that ran too long.", {
            threadId: run.threadId,
            cause,
          }),
        ),
      ),
  );

  const notifyPaused = Effect.fn("RoutineLimits.notifyPaused")(
    function* (paused: RoutineRunLedger.RoutinesPaused) {
      const project = Option.getOrUndefined(yield* projects.get(paused.projectId));
      yield* push.notifyAll({
        title: "Routines paused for today",
        body: `${project?.title ?? "Your notes"} reached ${paused.runsPerDay} routine runs today. They start again tomorrow.`,
        tag: `majordome:paused:${paused.projectId}`,
        url: "/feed",
      });
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Majordome could not say routines paused.", { cause }),
    ),
  );

  const start: RoutineLimits["Service"]["start"] = Effect.fn("RoutineLimits.start")(function* () {
    const limit = yield* makeRunTimeLimit(stop);
    // Runs per run event, under the stream's own span.
    const handle = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
      if (event.type === "runtime-request.updated") {
        return yield* limit.request(
          event.threadId,
          event.payload.id,
          event.payload.status === "pending",
        );
      }
      if (event.type !== "run.updated") return;
      const run = event.payload;
      if (ThreadManagement.isTerminalRunStatus(run.status)) {
        return yield* limit.ended(event.threadId, run.id);
      }
      if (run.status === "queued" || !firstTime(run.id)) return;
      const limited = yield* limitedRun(event.threadId, run).pipe(Effect.provide(services));
      if (limited !== null) yield* limit.started(limited);
    });
    yield* forkParked(
      Stream.runForEach(threads.streamDomainEvents, (event) =>
        handle(event).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Majordome could not check a routine's time.", {
              threadId: event.threadId,
              cause,
            }),
          ),
        ),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Majordome stopped checking routines' time.", { cause }),
        ),
      ),
    );
    yield* forkParked(Stream.runForEach(ledger.pauses, notifyPaused));
  });

  return RoutineLimits.of({ start });
});

export const layer = Layer.effect(RoutineLimits, make);
