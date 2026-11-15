import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import { type LimitedRun, makeRunTimeLimit } from "./RoutineLimits.ts";
import * as RoutineRunLedger from "./RoutineRunLedger.ts";

const vault = ProjectId.make("vault");

const routineRun = (name: string, runMinutes: number): LimitedRun => ({
  projectId: vault,
  threadId: ThreadId.make(`thread-${name}`),
  runId: RunId.make(`run-${name}`),
  title: name,
  runMinutes,
});

it.effect("stops a run once it has worked its time, not counting time waiting for the owner", () =>
  Effect.gen(function* () {
    const stopped = yield* Queue.unbounded<{ readonly threadId: string; readonly atMs: number }>();
    const limit = yield* makeRunTimeLimit((run) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((atMs) => Queue.offer(stopped, { threadId: run.threadId, atMs })),
      ),
    );
    const asks = routineRun("asks", 20);
    const finishes = routineRun("finishes", 20);
    yield* limit.started(asks);
    yield* limit.started(finishes);

    yield* TestClock.adjust("15 minutes");
    yield* limit.request(asks.threadId, "approval", true);
    yield* limit.ended(finishes.threadId, finishes.runId);
    // The owner answers two hours later; the run has 5 minutes left.
    yield* TestClock.adjust("2 hours");
    yield* limit.request(asks.threadId, "approval", false);
    yield* TestClock.adjust("10 minutes");

    assert.deepEqual(yield* Queue.take(stopped), {
      threadId: asks.threadId,
      atMs: (15 + 120 + 5) * 60_000,
    });
    assert.equal(yield* Queue.size(stopped), 0);
  }).pipe(Effect.scoped),
);

it.layer(
  RoutineRunLedger.layer.pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-runs-" })),
    Layer.provideMerge(NodeServices.layer),
  ),
)("the routine run count", (it) => {
  it.effect("pauses a vault once it used the day's runs, and starts again the next day", () =>
    Effect.gen(function* () {
      const ledger = yield* RoutineRunLedger.RoutineRunLedger;

      assert.isTrue(yield* ledger.take(vault, 2));
      assert.isTrue(yield* ledger.take(vault, 2));
      assert.isFalse((yield* ledger.read(vault)).pausedToday);
      assert.isFalse(yield* ledger.take(vault, 2));
      assert.isFalse(yield* ledger.take(vault, 2));
      assert.isTrue((yield* ledger.read(vault)).pausedToday);

      yield* ledger.recordStopped(vault, {
        threadId: ThreadId.make("thread-long"),
        runId: RunId.make("run-long"),
      });
      yield* TestClock.adjust("1 day");
      for (let run = 0; run < 3; run++) assert.isTrue(yield* ledger.take(vault, 3));
      const nextDay = yield* ledger.read(vault);
      assert.isFalse(nextDay.pausedToday);
      assert.deepEqual(
        nextDay.stoppedRuns.map((run) => run.runId),
        ["run-long"],
      );
      assert.isFalse(yield* ledger.take(vault, 3));

      // One notice per day, however many runs it skipped.
      assert.deepEqual(yield* Stream.runCollect(Stream.take(ledger.pauses, 2)), [
        { projectId: vault, runsPerDay: 2 },
        { projectId: vault, runsPerDay: 3 },
      ]);
    }),
  );
});
