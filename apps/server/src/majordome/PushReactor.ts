/**
 * Sends a vault run's notification to the owner's devices when it starts waiting for them, when it
 * couldn't finish, and when "Start my day" finishes. Runs outside vaults never notify.
 */

import type { OrchestrationV2DomainEvent, OrchestrationV2Run, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as MajordomePush from "./MajordomePush.ts";
import { decideVaultPush, isStartMyDayTask, makePushDedupe } from "./pushDecision.ts";

export class PushReactor extends Context.Service<
  PushReactor,
  { readonly start: () => Effect.Effect<void, never, Scope.Scope> }
>()("t3/majordome/PushReactor") {}

/** The events that can start or end a wait, or end a run. */
function isPushEvent(event: Pick<OrchestrationV2DomainEvent, "type">): boolean {
  return event.type === "run.updated" || event.type === "runtime-request.updated";
}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const push = yield* MajordomePush.MajordomePush;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environmentId = yield* (yield* ServerEnvironment.ServerEnvironment).getEnvironmentId;
  const firstTime = makePushDedupe();

  /** The final reply of a finished "Start my day" run, or null for any other run. */
  const startMyDayReply = Effect.fn("PushReactor.startMyDayReply")(function* (
    threadId: ThreadId,
    run: OrchestrationV2Run,
  ) {
    if (run.status !== "completed") return null;
    const userMessage = (yield* threads.getMessagesById(threadId, [run.userMessageId])).get(
      run.userMessageId,
    );
    if (!isStartMyDayTask(userMessage?.scheduledTaskId)) return null;
    const { messages } = yield* threads.getThreadRecords(threadId, ["messages"], {
      messageRunIds: [run.id],
      messageRoles: ["assistant"],
    });
    const reply = messages
      .filter((message) => message.role === "assistant" && message.text.trim() !== "")
      .toSorted((a, b) => DateTime.toEpochMillis(a.createdAt) - DateTime.toEpochMillis(b.createdAt))
      .at(-1);
    return reply?.text ?? "";
  });

  const handle = Effect.fn("PushReactor.handle")(function* (event: OrchestrationV2DomainEvent) {
    const thread = (yield* threads.getAgentAwarenessSnapshot(event.threadId)).threads[0];
    if (thread === undefined || thread.archivedAt !== null) return;
    const project = Option.getOrUndefined(yield* projects.get(thread.projectId));
    if (project === undefined) return;
    const isVault = yield* fileSystem
      .exists(path.join(project.workspaceRoot, ".majordome"))
      .pipe(Effect.orElseSucceed(() => false));
    if (!isVault) return;
    const decision = decideVaultPush({
      environmentId,
      projectTitle: project.title,
      thread,
      startMyDayReply:
        event.type === "run.updated" && event.payload.id === thread.latestRunId
          ? yield* startMyDayReply(event.threadId, event.payload)
          : null,
    });
    if (decision === null || !firstTime(decision.dedupeKey)) return;
    yield* Effect.logInfo("Majordome is sending a notification.", {
      kind: decision.kind,
      threadId: thread.id,
    });
    // Delivery waits on the network; the next events must not.
    yield* Effect.forkDetach(push.notifyAll(decision));
  });

  const start: PushReactor["Service"]["start"] = Effect.fn("PushReactor.start")(function* () {
    yield* forkParked(
      Stream.runForEach(threads.streamDomainEvents, (event) =>
        isPushEvent(event)
          ? handle(event).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Majordome could not decide on a notification.", {
                  threadId: event.threadId,
                  cause,
                }),
              ),
            )
          : Effect.void,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Majordome's notification stream stopped.", { cause }),
        ),
      ),
    );
  });

  return PushReactor.of({ start });
});

export const layer = Layer.effect(PushReactor, make);
