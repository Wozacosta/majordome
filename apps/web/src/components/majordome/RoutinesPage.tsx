import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Link } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { ChatComposerHandle } from "../chat/ChatComposer";
import { useComposerDraftStore } from "../../composerDraftStore";
import { requestConfirmDialog } from "../../confirmDialog";
import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { machineInSentence } from "./brains.logic";
import { Disclosure, EntryList, Muted, PageHeader, Section, StatusLine } from "./paper";
import { ReminderEntry, RoutineEntry } from "./RoutineEntry";
import { RoutineLimits } from "./RoutineLimits";
import { RoutinesAssistant } from "./RoutinesAssistant";
import { RoutinesBlockedLine } from "./RoutinesBlockedLine";
import {
  changeRoutineMessage,
  plainDateTime,
  type RoutineItem,
  routineKind,
  routineWhenLine,
  untilWords,
} from "./routines.logic";
import type { MajordomeVault } from "./topics.logic";
import { useMachineNames } from "./useMachineNames";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useVaultRoutines } from "./useVaultRoutines";

/**
 * A notes folder's routines and reminders beside the assistant that sets them up. On a narrow
 * screen the list comes first and the assistant opens over it.
 */
export function RoutinesPage() {
  const { activeVault, loading } = useMajordomeVaults();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border" />
        {activeVault === null ? (
          <div className="px-5 pt-6 sm:px-6">
            <PageHeader
              title="Routines"
              intro={loading ? undefined : "Open a notes folder to give it routines."}
            />
          </div>
        ) : (
          <VaultRoutines key={activeVault.key} vault={activeVault} />
        )}
      </div>
    </SidebarInset>
  );
}

function VaultRoutines({ vault }: { readonly vault: MajordomeVault }) {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const { machineOf } = useMachineNames();
  const { routines, reminders, runner, runnerHistory, runnerUnreachable, loading } =
    useVaultRoutines(vault);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const askToChange = (title: string) => {
    const text = changeRoutineMessage(title);
    // The assistant must be on screen before its text box can take the words and the cursor.
    flushSync(() => setAssistantOpen(true));
    if (composerRef.current?.insertTextAtEnd(text, { ensureLeadingBoundary: true })) {
      composerRef.current.focusAtEnd();
    } else if (runner !== null && runner.routinesThreadId !== null) {
      // Its text box is not there yet; the words wait in the conversation's draft.
      useComposerDraftStore
        .getState()
        .setPrompt(scopeThreadRef(runner.environmentId, runner.routinesThreadId), text);
    }
  };

  return (
    <div className="@container/routines flex min-h-0 flex-1">
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col @4xl/routines:flex",
          assistantOpen ? "hidden" : "flex",
        )}
      >
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col px-5 pt-6 pb-12 sm:px-6">
            <PageHeader
              title="Routines"
              intro="What Majordome does for you on its own, and what it will remind you of. To add or change one, tell the assistant."
              action={
                <span className="@4xl/routines:hidden">
                  <Button size="sm" onClick={() => setAssistantOpen(true)}>
                    Set up with the assistant
                  </Button>
                </span>
              }
            />
            {runner !== null ? (
              <div className="mt-3 flex flex-col">
                {vault.copies.length > 1 && !runnerUnreachable ? (
                  <Muted>
                    Routines run on {machineInSentence(machineOf(runner.environmentId))}.
                  </Muted>
                ) : null}
                {runnerUnreachable ? (
                  <StatusLine tone="warning" className="py-2.5">
                    Routines run on another computer that this window can't reach right now, so they
                    aren't listed here.
                  </StatusLine>
                ) : (
                  <RoutinesBlockedLine
                    environmentId={runner.environmentId}
                    status={runnerHistory?.routinesStatus}
                    machine={machineOf(runner.environmentId)}
                    label={null}
                  />
                )}
              </div>
            ) : null}

            <Section label="Routines">
              {routines.length > 0 ? (
                <EntryList aria-label="Routines">
                  {routines.map((item) => (
                    <RoutineRow
                      key={item.key}
                      item={item}
                      nowMs={nowMs}
                      onChange={() => askToChange(item.task.title)}
                    />
                  ))}
                </EntryList>
              ) : loading ? null : (
                <Muted className="border-t border-border py-3">
                  No routines yet. Tell the assistant what you'd like done and when, such as “every
                  Friday evening, list what I spent this week”.
                </Muted>
              )}
            </Section>

            <Section label="Reminders">
              {reminders.length > 0 ? (
                <EntryList aria-label="Reminders">
                  {reminders.map((item) => (
                    <ReminderRow key={item.key} item={item} nowMs={nowMs} />
                  ))}
                </EntryList>
              ) : loading ? null : (
                <Muted className="border-t border-border py-3">
                  Nothing coming up. Ask in any conversation, such as “remind me on Friday at 9 to
                  call the bank”.
                </Muted>
              )}
            </Section>

            <Disclosure summary="Limits" className="mt-8">
              <RoutineLimits />
            </Disclosure>
          </div>
        </ScrollArea>
      </div>

      {runner !== null ? (
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col @4xl/routines:flex @4xl/routines:max-w-md @4xl/routines:border-l @4xl/routines:border-border",
            assistantOpen ? "flex" : "hidden",
          )}
        >
          <RoutinesAssistant
            key={`${runner.environmentId}:${runner.projectId}`}
            copy={runner}
            composerRef={composerRef}
            onBack={() => setAssistantOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function useTaskAction(item: RoutineItem) {
  const { environmentId, task } = item;
  const canOperate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const [busy, setBusy] = useState(false);
  const toggle = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "routine on or off",
    reportFailure: false,
  });
  const run = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "routine run now",
    reportFailure: false,
  });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    label: "routine delete",
    reportFailure: false,
  });
  const act = async (action: "toggle" | "run" | "delete", confirmation?: string) => {
    if (busy || !canOperate) return;
    if (confirmation !== undefined) {
      const confirmed =
        (await requestConfirmDialog(confirmation, { variant: "destructive" })) ??
        window.confirm(confirmation);
      if (!confirmed) return;
    }
    setBusy(true);
    const input = { id: task.id };
    const result =
      action === "toggle"
        ? await toggle({ environmentId, input: { ...input, enabled: !task.enabled } })
        : action === "run"
          ? await run({ environmentId, input })
          : await remove({ environmentId, input });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: `Could not ${action === "run" ? "run" : action === "delete" ? "delete" : "change"} “${task.title}”`,
        description: failure instanceof Error ? failure.message : String(failure),
      });
    } else if (result._tag === "Success" && action === "run") {
      toastManager.add({ type: "success", title: `“${task.title}” is running` });
    }
  };
  return { act, disabled: busy || !canOperate };
}

function RoutineRow({
  item,
  nowMs,
  onChange,
}: {
  readonly item: RoutineItem;
  readonly nowMs: number;
  readonly onChange: () => void;
}) {
  const { task } = item;
  const { act, disabled } = useTaskAction(item);
  const calledFromOutside = routineKind(task) === "outside";
  return (
    <RoutineEntry
      title={task.title}
      prompt={task.prompt}
      when={routineWhenLine(task, nowMs, { serverTimeZone: item.timeZone })}
      lastRunStatus={task.lastRunStatus}
      lastRunError={task.lastRunError}
      controls={
        <>
          <Switch
            checked={task.enabled}
            disabled={disabled}
            aria-label={`${task.title} is ${task.enabled ? "on" : "off"}`}
            onCheckedChange={() => void act("toggle")}
          />
          {calledFromOutside ? null : (
            <Button size="xs" variant="outline" disabled={disabled} onClick={() => void act("run")}>
              Run now
            </Button>
          )}
          <Button size="xs" variant="ghost" disabled={disabled} onClick={onChange}>
            Edit
          </Button>
          <Button
            size="icon-sm"
            variant="ghost-destructive"
            disabled={disabled}
            aria-label={`Delete ${task.title}`}
            onClick={() =>
              void act("delete", `Delete the routine “${task.title}”?\nThis cannot be undone.`)
            }
          >
            <Trash2Icon />
          </Button>
        </>
      }
    />
  );
}

function ReminderRow({ item, nowMs }: { readonly item: RoutineItem; readonly nowMs: number }) {
  const { task, environmentId } = item;
  const { act, disabled } = useTaskAction(item);
  const threadRef = task.threadId === null ? null : scopeThreadRef(environmentId, task.threadId);
  const thread = useQuietThreadShell(threadRef);
  const at = task.nextRunAt ?? "";
  return (
    <ReminderEntry
      title={task.title}
      when={`${plainDateTime(at)} · ${untilWords(at, nowMs)}`}
      conversation={
        threadRef === null || thread === null ? null : (
          <>
            Posts in{" "}
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(threadRef)}
              className="rounded-sm text-foreground underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {thread.title}
            </Link>
          </>
        )
      }
      controls={
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled}
          aria-label={`Cancel the reminder ${task.title}`}
          onClick={() => void act("delete", `Cancel the reminder “${task.title}”?`)}
        >
          Cancel
        </Button>
      }
    />
  );
}
