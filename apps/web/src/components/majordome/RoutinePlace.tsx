import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScheduledTaskUpsertInput, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { type RoutineItem, routineTopicIds } from "./routines.logic";
import type { MajordomeVault } from "./topics.logic";

const OWN_CHAT = "own";

/**
 * Where a routine's runs arrive: a chat of its own, or one of the owner's topics. `copies` are
 * the servers' copies kept apart, since a routine posts in its own server's chat for the topic.
 */
export function RoutinePlace({
  item,
  vault,
  copies,
  disabled,
}: {
  readonly item: RoutineItem;
  readonly vault: Pick<MajordomeVault, "topics">;
  readonly copies: ReadonlyArray<MajordomeVault>;
  readonly disabled: boolean;
}) {
  const { environmentId, task } = item;
  const [busy, setBusy] = useState(false);
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    label: "routine place",
    reportFailure: false,
  });
  const openTopic = useAtomCommand(majordomeEnvironment.openTopic, {
    label: "open a topic",
    reportFailure: false,
  });
  const topicId = routineTopicIds([item], copies).get(item.key) ?? null;
  const topic = vault.topics.find((entry) => entry.id === topicId);

  const failed = (result: AtomCommandResult<unknown, unknown>) => {
    if (result._tag !== "Failure") return false;
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: `Could not move “${task.title}”`,
        description: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  };

  const save = (place: Pick<ScheduledTaskUpsertInput, "threadId" | "threadMode">) =>
    upsert({
      environmentId,
      input: {
        id: task.id,
        requireExisting: true,
        title: task.title,
        prompt: task.prompt,
        enabled: task.enabled,
        schedule: task.schedule.type === "webhook" ? { type: "webhook" } : task.schedule,
        projectId: task.projectId,
        workspaceStrategy: task.workspaceStrategy,
        modelSelection: task.modelSelection,
        runtimeMode: task.runtimeMode,
        interactionMode: task.interactionMode,
        ...place,
      },
    });

  /** The topic's chat on the routine's server, started there if it never was. */
  const topicThreadId = async (id: string): Promise<ThreadId | null> => {
    const known = copies
      .find((copy) => copy.environmentId === environmentId && copy.projectId === task.projectId)
      ?.topics.find((entry) => entry.id === id)?.threadId;
    if (known != null) return known;
    const opened = await openTopic({
      environmentId,
      input: { projectId: task.projectId, topicId: id },
    });
    return failed(opened) || opened._tag !== "Success" ? null : opened.value.threadId;
  };

  const move = async (next: string) => {
    if (busy || next === (topicId ?? OWN_CHAT)) return;
    setBusy(true);
    if (next === OWN_CHAT) {
      // A routine only leaves a chat by going back to a chat per run; then it keeps a new one.
      if (!failed(await save({ threadMode: "new_thread" }))) {
        failed(await save({ threadMode: "fresh_session" }));
      }
    } else {
      const threadId = await topicThreadId(next);
      // Continuing, so the routine reads what was said in the topic and the topic keeps its thread.
      if (threadId !== null) failed(await save({ threadId, threadMode: "continue" }));
    }
    setBusy(false);
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span id={`routine-place-${task.id}`}>Posts in</span>
      <div className="w-44">
        <Select
          value={topicId ?? OWN_CHAT}
          disabled={disabled || busy}
          onValueChange={(next) => {
            if (typeof next === "string") void move(next);
          }}
        >
          <SelectTrigger size="sm" aria-labelledby={`routine-place-${task.id}`}>
            <SelectValue>{topic?.title ?? "Its own chat"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={OWN_CHAT}>Its own chat</SelectItem>
            {vault.topics.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.title}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {task.threadId !== null ? (
        <Link
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(environmentId, task.threadId))}
          className="rounded-sm text-foreground underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          Open the chat
        </Link>
      ) : (
        <span>Its chat starts with the first run.</span>
      )}
    </div>
  );
}
