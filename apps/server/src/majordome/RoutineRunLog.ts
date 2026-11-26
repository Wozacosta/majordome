/**
 * The runs of each scheduled task over the last weeks, for the Routines calendar. The scheduler
 * keeps only a task's last run, so this server writes each one down as the task list changes,
 * in its state directory.
 */

import {
  MajordomeRoutineRun,
  type ProjectId,
  type ScheduledTask,
  ScheduledTaskId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { forkParked } from "../serverActivation.ts";

const KEPT_MS = 35 * 24 * 60 * 60 * 1_000;
/** A routine that runs every minute would otherwise fill the file. */
const MAX_RUNS = 5_000;
const MAX_RUNS_READ = 500;

const RunLogState = Schema.Struct({
  runs: Schema.Array(MajordomeRoutineRun),
  /** Each task's next run when last seen: the time of a run it then skips. */
  due: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
});
export type RunLogState = typeof RunLogState.Type;
const RunLogJson = Schema.fromJsonString(RunLogState);
const decodeLog = Schema.decodeUnknownOption(RunLogJson);
const encodeLog = Schema.encodeSync(RunLogJson);

export const EMPTY_RUN_LOG: RunLogState = { runs: [], due: {} };

type SeenTask = Pick<
  ScheduledTask,
  "id" | "nextRunAt" | "lastRunAt" | "lastRunStatus" | "lastRunErrorCode"
>;

/**
 * The log after seeing the task list. A run is its task and start time, so a later status for
 * the same start replaces the earlier one. A skipped run never started: it is written at the
 * time it was due, and the run before it keeps its own status.
 */
export function recordRuns(
  state: RunLogState,
  tasks: ReadonlyArray<SeenTask>,
  nowMs: number,
): RunLogState {
  const live = new Set<string>(tasks.map((task) => task.id));
  const runs = new Map(
    state.runs
      .filter((run) => live.has(run.taskId) && Date.parse(run.at) >= nowMs - KEPT_MS)
      .map((run) => [`${run.taskId}\n${run.at}`, run]),
  );
  for (const task of tasks) {
    const code = task.lastRunErrorCode;
    if (code === "missed" || code === "held") {
      const due = state.due[task.id];
      if (due != null && due !== task.nextRunAt && Date.parse(due) <= nowMs) {
        runs.set(`${task.id}\n${due}`, {
          taskId: task.id,
          at: due,
          status: "failed",
          errorCode: code,
        });
      }
    } else if (task.lastRunAt !== null && task.lastRunStatus !== "never") {
      runs.set(`${task.id}\n${task.lastRunAt}`, {
        taskId: task.id,
        at: task.lastRunAt,
        status: task.lastRunStatus,
        ...(code === undefined ? {} : { errorCode: code }),
      });
    }
  }
  return {
    runs: [...runs.values()]
      .toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at))
      .slice(-MAX_RUNS),
    due: Object.fromEntries(tasks.map((task) => [task.id, task.nextRunAt])),
  };
}

export class RoutineRunLog extends Context.Service<
  RoutineRunLog,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** A project's runs from `from` up to `to`, oldest first; the newest when there are too many. */
    readonly read: (input: {
      readonly projectId: ProjectId;
      readonly from: string;
      readonly to: string;
    }) => Effect.Effect<ReadonlyArray<MajordomeRoutineRun>>;
  }
>()("t3/majordome/RoutineRunLog") {}

const make = Effect.gen(function* () {
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const logPath = path.join(
    (yield* ServerConfig.ServerConfig).stateDir,
    "majordome",
    "routine-runs.json",
  );
  const loaded = Option.flatMap(
    yield* fileSystem.readFileString(logPath).pipe(Effect.option),
    decodeLog,
  );
  const log = yield* Ref.make(Option.getOrElse(loaded, () => EMPTY_RUN_LOG));

  const persist = Effect.gen(function* () {
    yield* fileSystem.makeDirectory(path.dirname(logPath), { recursive: true });
    const temporary = `${logPath}.tmp`;
    yield* fileSystem.writeFileString(temporary, encodeLog(yield* Ref.get(log)));
    yield* fileSystem.rename(temporary, logPath);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Majordome could not save its log of routine runs.", { cause }),
    ),
  );

  const see = Effect.fn("RoutineRunLog.see")(function* (tasks: ReadonlyArray<ScheduledTask>) {
    const nowMs = yield* Clock.currentTimeMillis;
    const changed = yield* Ref.modify(log, (current) => {
      const next = recordRuns(current, tasks, nowMs);
      return [encodeLog(next) !== encodeLog(current), next];
    });
    if (changed) yield* persist;
  });

  const start: RoutineRunLog["Service"]["start"] = Effect.fn("RoutineRunLog.start")(function* () {
    yield* forkParked(
      scheduledTasks.subscribeList().pipe(
        Stream.runForEach((list) => see(list.tasks)),
        Effect.catchCause((cause) =>
          Effect.logWarning("Majordome stopped logging routine runs.", { cause }),
        ),
      ),
    );
  });

  const read: RoutineRunLog["Service"]["read"] = Effect.fn("RoutineRunLog.read")(function* (input) {
    const tasks = yield* scheduledTasks.list().pipe(
      Effect.map((list) => list.tasks),
      Effect.orElseSucceed((): ReadonlyArray<ScheduledTask> => []),
    );
    // Reading also records, so a run that just ended is there before the stream delivers it.
    yield* see(tasks);
    const ours = new Set<ScheduledTaskId>(
      tasks.filter((task) => task.projectId === input.projectId).map((task) => task.id),
    );
    const from = Date.parse(input.from);
    const to = Date.parse(input.to);
    return (yield* Ref.get(log)).runs
      .filter((run) => {
        const at = Date.parse(run.at);
        return ours.has(run.taskId) && at >= from && at < to;
      })
      .slice(-MAX_RUNS_READ);
  });

  return RoutineRunLog.of({ start, read });
});

export const layer = Layer.effect(RoutineRunLog, make);
