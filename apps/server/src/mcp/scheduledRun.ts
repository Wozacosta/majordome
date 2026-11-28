import { type RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

/** Whether a thread's run was started by a scheduled task, and so has nobody watching it. */
export const isScheduledRun = (
  threads: ThreadManagementService.ThreadManagementService["Service"],
  threadId: string,
  runId: RunId | null,
) =>
  runId === null
    ? Effect.succeed(false)
    : Effect.gen(function* () {
        const id = ThreadId.make(threadId);
        const { runs } = yield* threads.getThreadRecords(id, ["runs"], { runIds: [runId] });
        const run = runs.find((candidate) => candidate.id === runId);
        if (run === undefined) return false;
        const messages = yield* threads.getMessagesById(id, [run.userMessageId]);
        return messages.get(run.userMessageId)?.scheduledTaskId !== undefined;
      }).pipe(Effect.orElseSucceed(() => false));
