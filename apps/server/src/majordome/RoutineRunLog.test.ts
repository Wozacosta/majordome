import { ScheduledTaskId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { EMPTY_RUN_LOG, recordRuns } from "./RoutineRunLog.ts";

const NOW = Date.parse("2026-11-26T12:00:00.000Z");
const id = ScheduledTaskId.make("task-1");
const task = (
  fields: Partial<Parameters<typeof recordRuns>[1][number]>,
): Parameters<typeof recordRuns>[1][number] => ({
  id,
  nextRunAt: "2026-11-27T08:00:00.000Z",
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunErrorCode: undefined,
  ...fields,
});

describe("recordRuns", () => {
  it("writes a run once and follows its status to the end", () => {
    const at = "2026-11-26T08:00:00.000Z";
    const running = recordRuns(
      EMPTY_RUN_LOG,
      [task({ lastRunAt: at, lastRunStatus: "running" })],
      NOW,
    );
    expect(running.runs).toEqual([{ taskId: id, at, status: "running" }]);

    const failed = recordRuns(
      running,
      [task({ lastRunAt: at, lastRunStatus: "failed", lastRunErrorCode: "stopped" })],
      NOW,
    );
    expect(failed.runs).toEqual([{ taskId: id, at, status: "failed", errorCode: "stopped" }]);
  });

  it("writes a skipped run at the time it was due and leaves the run before it alone", () => {
    const ran = "2026-11-24T08:00:00.000Z";
    const due = "2026-11-25T08:00:00.000Z";
    const before = recordRuns(
      EMPTY_RUN_LOG,
      [task({ nextRunAt: due, lastRunAt: ran, lastRunStatus: "succeeded" })],
      Date.parse(ran),
    );
    const after = recordRuns(
      before,
      [task({ lastRunAt: ran, lastRunStatus: "failed", lastRunErrorCode: "missed" })],
      NOW,
    );
    expect(after.runs).toEqual([
      { taskId: id, at: ran, status: "succeeded" },
      { taskId: id, at: due, status: "failed", errorCode: "missed" },
    ]);
    // Seeing the same list again adds nothing.
    expect(
      recordRuns(
        after,
        [task({ lastRunAt: ran, lastRunStatus: "failed", lastRunErrorCode: "missed" })],
        NOW,
      ),
    ).toEqual(after);
  });

  it("does not guess when a skipped run was due without having seen it", () => {
    const log = recordRuns(
      EMPTY_RUN_LOG,
      [task({ lastRunStatus: "failed", lastRunErrorCode: "missed" })],
      NOW,
    );
    expect(log.runs).toEqual([]);
  });

  it("forgets old runs and the runs of a deleted task", () => {
    const old = "2026-10-01T08:00:00.000Z";
    const recent = "2026-11-25T08:00:00.000Z";
    const other = ScheduledTaskId.make("task-2");
    const log = recordRuns(
      {
        runs: [
          { taskId: id, at: old, status: "succeeded" },
          { taskId: id, at: recent, status: "succeeded" },
          { taskId: other, at: recent, status: "succeeded" },
        ],
        due: {},
      },
      [task({})],
      NOW,
    );
    expect(log.runs).toEqual([{ taskId: id, at: recent, status: "succeeded" }]);
  });
});
