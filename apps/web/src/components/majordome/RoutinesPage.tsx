import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Link, useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useQuietThreadShell } from "../../state/entities";
import { majordomeEnvironment } from "../../state/majordome";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { useAskAssistant } from "./AssistantDock";
import { machineInSentence } from "./brains.logic";
import { MoveRoutinesDialog } from "./MoveRoutinesDialog";
import {
  Disclosure,
  EntryList,
  ListSkeleton,
  LoadFailed,
  Muted,
  PageHeader,
  Section,
  StatusLine,
  SwitchLabel,
} from "./paper";
import { ReadyRoutines } from "./ReadyRoutines";
import { ReminderEntry, RoutineEntry } from "./RoutineEntry";
import { RoutineLimits } from "./RoutineLimits";
import { RoutinePlace } from "./RoutinePlace";
import { RoutinesBlockedLine } from "./RoutinesBlockedLine";
import {
  changeRoutineMessage,
  NEW_ROUTINE_MESSAGE,
  plainDateTime,
  type RoutineItem,
  routineKind,
  routineLastRun,
  type RoutinesHold,
  routinesHold,
  routinesPausedText,
  ROUTINES_NOWHERE_TEXT,
  routineWhenLine,
  untilWords,
} from "./routines.logic";
import type { MajordomeVault } from "./topics.logic";
import { useMachineNames } from "./useMachineNames";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useVaultRoutines } from "./useVaultRoutines";

/**
 * A notes folder's routines beside the assistant that sets them up. On a narrow
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
  const { machineOf, localEnvironmentId } = useMachineNames();
  const { routines, runner, runnerHistory, runnerUnreachable, loading, routinesFailed, retry } =
    useVaultRoutines(vault);
  const canChange = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom((runner ?? vault).environmentId),
  );
  const canMoveHere = useAtomValue(
    majordomeEnvironment.runRoutinesHere.permissionAtom(vault.environmentId),
  );
  const [moving, setMoving] = useState(false);
  const { copies } = useMajordomeVaults();
  const askAssistant = useAskAssistant();
  const askToChange = (title: string) => askAssistant?.(changeRoutineMessage(title));
  const hold = runnerUnreachable ? null : routinesHold(runnerHistory);
  const newRoutine =
    askAssistant === null || !canChange || runnerUnreachable ? null : (
      <Button size="sm" onClick={() => askAssistant(NEW_ROUTINE_MESSAGE)}>
        Set up a routine
      </Button>
    );

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-5 pt-6 pb-12 sm:px-6">
        <PageHeader
          title="Routines"
          intro="What Majordome does for you on its own. To add or change one, tell the assistant."
          action={routines.length > 0 ? newRoutine : null}
        />
        {runner !== null ? (
          <div className="mt-3 flex flex-col">
            {vault.copies.length > 1 && !runnerUnreachable ? (
              <Muted>Routines run on {machineInSentence(machineOf(runner.environmentId))}.</Muted>
            ) : null}
            {runnerUnreachable ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusLine tone="warning" className="flex-1 basis-64 py-2.5">
                  Routines run on another computer that this window can't reach right now, so they
                  aren't listed here.
                  {canMoveHere ? " You can have this computer run them instead." : ""}
                </StatusLine>
                {canMoveHere ? (
                  <Button size="xs" variant="outline" onClick={() => setMoving(true)}>
                    Move routines here
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <RoutinesBlockedLine
                  environmentId={runner.environmentId}
                  status={runnerHistory?.routinesStatus}
                  machine={machineOf(runner.environmentId)}
                  label={null}
                />
                {hold === "nowhere" ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusLine
                      tone="warning"
                      className="flex-1 basis-64 py-2.5"
                      data-routines-hold={hold}
                    >
                      {ROUTINES_NOWHERE_TEXT}, so none of them will run.
                    </StatusLine>
                    {canMoveHere ? (
                      <Button size="xs" variant="outline" onClick={() => setMoving(true)}>
                        Move routines here
                      </Button>
                    ) : null}
                  </div>
                ) : hold === "paused" ? (
                  <StatusLine tone="warning" className="py-2.5" data-routines-hold={hold}>
                    {routinesPausedText(runnerHistory?.routineLimits?.runsPerDay ?? null)}. You can
                    change that number under Limits below.
                  </StatusLine>
                ) : hold === null &&
                  runnerHistory?.routinesRunner === "this-server" &&
                  runner.environmentId === localEnvironmentId ? (
                  <StatusLine tone="neutral" className="py-2.5" data-routines-awake-only>
                    Routines run only while this computer is awake.{" "}
                    <Link
                      to="/settings/always-on"
                      className="rounded-sm underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      Move them to an always-on server
                    </Link>
                  </StatusLine>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {runnerUnreachable ? null : (
          <Section label="Routines">
            {!canChange && routines.length > 0 ? (
              <Muted className="mb-2">
                You can look at routines from this device, but it isn't allowed to change them.
              </Muted>
            ) : null}
            {routines.length > 0 ? (
              <EntryList aria-label="Routines">
                {routines.map((item) => (
                  <RoutineRow
                    key={item.key}
                    item={item}
                    vault={vault}
                    copies={copies}
                    nowMs={nowMs}
                    hold={hold}
                    onChange={() => askToChange(item.task.title)}
                  />
                ))}
              </EntryList>
            ) : loading ? (
              <ListSkeleton />
            ) : routinesFailed ? (
              <LoadFailed onRetry={retry}>Couldn't load your routines.</LoadFailed>
            ) : (
              <div className="flex flex-col items-start gap-3 border-t border-border py-3">
                <Muted>
                  No routines yet. Tell the assistant what you'd like done and when, such as “every
                  Friday evening, list what I spent this week”.
                </Muted>
                {newRoutine}
              </div>
            )}
          </Section>
        )}

        {runnerUnreachable ? null : (
          <ReadyRoutines
            environmentId={(runner ?? vault).environmentId}
            projectId={(runner ?? vault).projectId}
            topicTitles={new Map(vault.topics.map((topic) => [topic.id, topic.title]))}
          />
        )}

        <Disclosure summary="Limits" className="mt-8" open={hold === "paused"}>
          <RoutineLimits />
        </Disclosure>
        <MoveRoutinesDialog
          vault={moving ? { ...vault, routinesRunner: "another-server" } : null}
          onClose={() => setMoving(false)}
        />
      </div>
    </ScrollArea>
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
  const navigate = useNavigate();
  const act = async (
    action: "toggle" | "run" | "delete",
    confirmation?: { readonly question: string; readonly confirm: string },
  ) => {
    if (busy || !canOperate) return;
    if (confirmation !== undefined) {
      const confirmed =
        (await requestConfirmDialog(confirmation.question, {
          variant: "destructive",
          labels: { confirm: confirmation.confirm, cancel: "Keep it" },
        })) ?? window.confirm(confirmation.question);
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
      const threadId = "task" in result.value ? result.value.task.threadId : null;
      const toastId = toastManager.add({
        type: "success",
        title: `“${task.title}” is running`,
        ...(threadId === null
          ? {}
          : {
              actionProps: {
                children: "Open the chat",
                onClick: () => {
                  toastManager.close(toastId);
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
                  });
                },
              },
            }),
      });
    }
  };
  return { act, disabled: busy || !canOperate };
}

function RoutineRow({
  item,
  vault,
  copies,
  nowMs,
  hold,
  onChange,
}: {
  readonly item: RoutineItem;
  readonly vault: MajordomeVault;
  readonly copies: ReadonlyArray<MajordomeVault>;
  readonly nowMs: number;
  readonly hold: RoutinesHold | null;
  readonly onChange: () => void;
}) {
  const { task } = item;
  const { act, disabled } = useTaskAction(item);
  const calledFromOutside = routineKind(task) === "outside";
  const running = task.lastRunStatus === "running";
  const lastRun = routineLastRun(task, nowMs, { serverTimeZone: item.timeZone });
  const linkClass =
    "rounded-sm underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
  return (
    <RoutineEntry
      title={task.title}
      prompt={task.prompt}
      when={routineWhenLine(task, nowMs, { serverTimeZone: item.timeZone, hold })}
      lastRun={lastRun}
      lastRunRemedy={
        lastRun?.remedy === "run-now" ? (
          <>
            Press Run now to do it now, or{" "}
            <Link to="/settings/always-on" className={linkClass}>
              keep routines running while the computer sleeps
            </Link>
          </>
        ) : lastRun?.remedy === "open-chat" && task.threadId !== null ? (
          <>
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(scopeThreadRef(item.environmentId, task.threadId))}
              className={linkClass}
            >
              Open the chat
            </Link>{" "}
            to let it go ahead or remove it
          </>
        ) : null
      }
      place={
        calledFromOutside ? null : (
          <RoutinePlace item={item} vault={vault} copies={copies} disabled={disabled} />
        )
      }
      controls={
        <>
          <SwitchLabel className="me-1 text-xs text-muted-foreground">
            <Switch
              checked={task.enabled}
              disabled={disabled}
              aria-label={`${task.title} is ${task.enabled ? "on" : "off"}`}
              onCheckedChange={() => void act("toggle")}
            />
            {task.enabled ? "On" : "Off"}
          </SwitchLabel>
          {calledFromOutside ? null : (
            <Button
              size="xs"
              variant="outline"
              disabled={disabled || running}
              onClick={() => void act("run")}
            >
              {running ? "Running…" : "Run now"}
            </Button>
          )}
          <Button size="xs" variant="ghost" disabled={disabled} onClick={onChange}>
            Edit
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost-destructive"
                  disabled={disabled}
                  aria-label={`Delete ${task.title}`}
                  onClick={() =>
                    void act("delete", {
                      question: `Delete the routine “${task.title}”?\nThis cannot be undone.`,
                      confirm: "Delete routine",
                    })
                  }
                />
              }
            >
              <Trash2Icon />
            </TooltipTrigger>
            <TooltipPopup>Delete this routine</TooltipPopup>
          </Tooltip>
        </>
      }
    />
  );
}

export function ReminderRow({
  item,
  nowMs,
}: {
  readonly item: RoutineItem;
  readonly nowMs: number;
}) {
  const { task, environmentId } = item;
  const { act, disabled } = useTaskAction(item);
  const threadRef = task.threadId === null ? null : scopeThreadRef(environmentId, task.threadId);
  const thread = useQuietThreadShell(threadRef);
  const { copies } = useMajordomeVaults();
  // That chat is the panel beside this page and is in no list, so a link would lead nowhere findable.
  const postsInAssistant = copies.some((vault) =>
    vault.copies.some(
      (copy) => copy.environmentId === environmentId && copy.routinesThreadId === task.threadId,
    ),
  );
  const at = task.nextRunAt ?? "";
  return (
    <ReminderEntry
      title={task.title}
      when={`${plainDateTime(at)} · ${untilWords(at, nowMs)}`}
      conversation={
        threadRef === null || thread === null ? null : postsInAssistant ? (
          "Posts in your chat with the assistant"
        ) : (
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
          onClick={() =>
            void act("delete", {
              question: `Cancel the reminder “${task.title}”?`,
              confirm: "Cancel reminder",
            })
          }
        >
          Cancel
        </Button>
      }
    />
  );
}
