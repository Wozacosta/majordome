/**
 * This server's count of unattended runs per vault and day, and the runs the time limit stopped.
 * Kept in the server's state directory: each server counts the runs it starts. Days are local, like
 * the routines' schedules.
 */

import { MajordomeStoppedRun, type ProjectId, type RunId, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";

const STOPPED_RUNS_KEPT = 20;

const VaultRuns = Schema.Struct({
  day: Schema.String,
  started: Schema.Number,
  /** A run was skipped today because `started` reached the vault's runs per day. */
  paused: Schema.Boolean,
  stopped: Schema.Array(MajordomeStoppedRun),
});
type VaultRuns = typeof VaultRuns.Type;
const LedgerJson = Schema.fromJsonString(
  Schema.Struct({ vaults: Schema.Record(Schema.String, VaultRuns) }),
);
const decodeLedger = Schema.decodeUnknownOption(LedgerJson);
const encodeLedger = Schema.encodeSync(LedgerJson);

export interface RoutinesPaused {
  readonly projectId: ProjectId;
  readonly runsPerDay: number;
}

export class RoutineRunLedger extends Context.Service<
  RoutineRunLedger,
  {
    /** Counts an unattended run, or says no once the vault has used today's runs. */
    readonly take: (projectId: ProjectId, runsPerDay: number) => Effect.Effect<boolean>;
    readonly recordStopped: (
      projectId: ProjectId,
      run: { readonly threadId: ThreadId; readonly runId: RunId },
    ) => Effect.Effect<void>;
    readonly read: (projectId: ProjectId) => Effect.Effect<{
      readonly pausedToday: boolean;
      readonly stoppedRuns: ReadonlyArray<MajordomeStoppedRun>;
    }>;
    /** A vault the first time a run is skipped on a day, for one reader. */
    readonly pauses: Stream.Stream<RoutinesPaused>;
  }
>()("t3/majordome/RoutineRunLedger") {}

const today = DateTime.withCurrentZoneLocal(DateTime.nowInCurrentZone).pipe(
  Effect.map(DateTime.formatIsoDate),
);

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ledgerPath = path.join(
    (yield* ServerConfig.ServerConfig).stateDir,
    "majordome",
    "runs.json",
  );
  const loaded = Option.flatMap(
    yield* fileSystem.readFileString(ledgerPath).pipe(Effect.option),
    decodeLedger,
  );
  const vaults = yield* Ref.make<Readonly<Record<string, VaultRuns>>>(
    Option.match(loaded, { onNone: () => ({}), onSome: (ledger) => ledger.vaults }),
  );
  const writeLock = yield* Semaphore.make(1);
  const paused = yield* Queue.unbounded<RoutinesPaused>();

  const persist = writeLock.withPermits(1)(
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(path.dirname(ledgerPath), { recursive: true });
      const temporary = `${ledgerPath}.tmp`;
      yield* fileSystem.writeFileString(
        temporary,
        encodeLedger({ vaults: yield* Ref.get(vaults) }),
      );
      yield* fileSystem.rename(temporary, ledgerPath);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Majordome could not save its count of routine runs.", { cause }),
      ),
    ),
  );

  /** The vault's record for `day`; a new day starts a fresh count and keeps the stopped runs. */
  const forDay = (current: Readonly<Record<string, VaultRuns>>, projectId: string, day: string) => {
    const existing = current[projectId];
    if (existing?.day === day) return existing;
    return { day, started: 0, paused: false, stopped: existing?.stopped ?? [] };
  };

  const take: RoutineRunLedger["Service"]["take"] = Effect.fn("RoutineRunLedger.take")(
    function* (projectId, runsPerDay) {
      const day = yield* today;
      const outcome = yield* Ref.modify(vaults, (current) => {
        const record = forDay(current, projectId, day);
        if (record.started < runsPerDay) {
          return [
            "started" as const,
            { ...current, [projectId]: { ...record, started: record.started + 1 } },
          ];
        }
        return [
          record.paused ? ("still-paused" as const) : ("paused" as const),
          { ...current, [projectId]: { ...record, paused: true } },
        ];
      });
      if (outcome !== "still-paused") yield* persist;
      if (outcome === "paused") yield* Queue.offer(paused, { projectId, runsPerDay });
      return outcome === "started";
    },
  );

  const recordStopped: RoutineRunLedger["Service"]["recordStopped"] = Effect.fn(
    "RoutineRunLedger.recordStopped",
  )(function* (projectId, run) {
    const day = yield* today;
    const stoppedAt = DateTime.formatIso(yield* DateTime.now);
    yield* Ref.update(vaults, (current) => {
      const record = forDay(current, projectId, day);
      const stopped = [{ ...run, stoppedAt }, ...record.stopped].slice(0, STOPPED_RUNS_KEPT);
      return { ...current, [projectId]: { ...record, stopped } };
    });
    yield* persist;
  });

  const read: RoutineRunLedger["Service"]["read"] = Effect.fn("RoutineRunLedger.read")(
    function* (projectId) {
      const record = (yield* Ref.get(vaults))[projectId];
      return {
        pausedToday: record !== undefined && record.paused && record.day === (yield* today),
        stoppedRuns: record?.stopped ?? [],
      };
    },
  );

  return RoutineRunLedger.of({ take, recordStopped, read, pauses: Stream.fromQueue(paused) });
});

export const layer = Layer.effect(RoutineRunLedger, make);
