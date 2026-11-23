import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type MajordomeRoutineKind,
  type MajordomeRoutinesRunner,
  type MajordomeVaultHistoryResult,
  type MajordomeVaultUndoResult,
  ThreadId,
} from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import {
  CalendarClockIcon,
  CalendarRangeIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  InboxIcon,
  type LucideIcon,
  MessageSquareIcon,
  MoonIcon,
  NotebookPenIcon,
  SunriseIcon,
  Undo2Icon,
} from "lucide-react";
import { createContext, Fragment, useContext, useState } from "react";

import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import {
  majordomeEnvironment,
  vaultBackupStatusesAtom,
  vaultHistoriesAtom,
} from "../../state/majordome";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatFullTimestamp, formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  buildFeedItems,
  buildFeedRunItems,
  classifyFeedEntry,
  FEED_RUN_STATUS_LABELS,
  type FeedEditGroup,
  type FeedItem,
  feedNotes,
  type FeedOwnDay,
  feedRunSummary,
  type FeedVaultNotes,
  feedVaultNotes,
  foldOwnChanges,
  groupFeedItems,
  memoryOverLimitLine,
  ownDayLine,
  type FeedRunItem,
  type FeedVault,
  stoppedRunKeys,
  withDayHeadings,
} from "./feed.logic";
import { BackupStatusLine } from "./BackupStatusLine";
import { MoveRoutinesDialog } from "./MoveRoutinesDialog";
import { RoutinesBlockedLine } from "./RoutinesBlockedLine";
import {
  copyLabel,
  groupBrains,
  machineInSentence,
  routinesMachine,
  runnerCopy,
  statusBrainId,
} from "./brains.logic";
import { notesLink } from "./notes.logic";
import { ROUTINES_NOWHERE_TEXT, routinesPausedText } from "./routines.logic";
import { ApprovalFeedRequest } from "./ApprovalRequestCard";
import { PrivateDocumentFeedRequest } from "./PrivateDocumentRequestCard";
import {
  Entry,
  EntryList,
  PageTitle,
  READING_MEASURE_CLASS,
  ROW_ACTION_CLASS,
  Section,
  SectionLabel,
  StatusLine,
} from "./paper";
import { useMachineNames } from "./useMachineNames";

interface FeedVaultState extends FeedVault {
  readonly routinesRunner: MajordomeRoutinesRunner;
  /** Today's runs are used up, so routines wait for tomorrow; null when they are not. */
  readonly pausedRunsPerDay: number | null;
  readonly stoppedRuns: NonNullable<MajordomeVaultHistoryResult["stoppedRuns"]>;
}

export function FeedPage() {
  const [includeOwnChanges, setIncludeOwnChanges] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<FeedItem | null>(null);
  const [pendingMove, setPendingMove] = useState<FeedVaultState | null>(null);
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);

  const projects = useProjects().filter((project) => !project.isScratch && !project.archivedAt);
  const key = JSON.stringify(projects.map((project) => [project.environmentId, project.id]));
  const results = useAtomValue(vaultHistoriesAtom(key));
  // The backup status says which brain each copy is.
  const statuses = useAtomValue(vaultBackupStatusesAtom(key));
  const { primaryEnvironmentId, machineOf } = useMachineNames();

  const threads = useQuietThreadShells();
  const copies: Array<
    FeedVaultState & {
      readonly brainId: string | null;
      readonly history: MajordomeVaultHistoryResult;
    }
  > = [];
  const errors: Array<string> = [];
  let loading = false;
  projects.forEach((project, index) => {
    const result = results[index];
    const brainId = statusBrainId(statuses[index]);
    if (result === undefined || result._tag === "Initial" || brainId === undefined) {
      loading = true;
      return;
    }
    if (result._tag === "Failure") {
      errors.push(`${project.title}: ${formatEnvironmentQueryError(result.cause)}`);
    }
    const history = AsyncResult.getOrElse(result, () => null);
    if (history?.isVault) {
      copies.push({
        environmentId: project.environmentId,
        projectId: project.id,
        title: project.title,
        brainId,
        routinesRunner: history.routinesRunner,
        pausedRunsPerDay: history.pausedToday ? (history.routineLimits?.runsPerDay ?? null) : null,
        stoppedRuns: history.stoppedRuns ?? [],
        history,
      });
    }
  });
  const brains = groupBrains(copies, primaryEnvironmentId).map((brain) => {
    const several = brain.copies.length > 1;
    const [own] = brain.copies;
    return {
      key: brain.key,
      runner: runnerCopy(brain),
      runsOn: routinesMachine(brain, machineOf),
      moveTo: own.routinesRunner === "this-server" ? null : own,
      copies: brain.copies.map((copy) => ({
        ...copy,
        brainKey: brain.key,
        machine: several ? machineOf(copy.environmentId) : null,
      })),
    };
  });
  const vaults = brains.flatMap((brain) => brain.copies);
  const vaultNotes = new Map(
    vaults.map((vault) => [vaultKey(vault), feedVaultNotes(vault.history)]),
  );
  const runItems = buildFeedRunItems(threads, vaults, stoppedRunKeys(vaults));
  const changes = buildFeedItems(
    vaults.map((vault) => ({ vault, entries: vault.history.entries })),
    {
      includeOwnChanges: true,
      knownThreads: new Set(threads.map((thread) => `${thread.environmentId}:${thread.id}`)),
    },
  );
  const timeline = includeOwnChanges
    ? null
    : withDayHeadings(
        foldOwnChanges(changes),
        (row) => (row.kind === "own-day" ? row.at : row.item.entry.committedAt),
        nowMs,
      );
  const grouped = includeOwnChanges
    ? withDayHeadings(
        groupFeedItems(changes),
        (row) => (row.kind === "edits" ? row.saves[0] : row.item)?.entry.committedAt ?? "",
        nowMs,
      )
    : null;
  const itemCount = timeline?.length ?? grouped?.length ?? 0;
  const showVaultName = brains.length > 1;
  const renderChange = (item: FeedItem) =>
    item.entry.byMajordome ? (
      <FeedRunCard
        item={item}
        nowMs={nowMs}
        showVaultName={showVaultName}
        vaultNotes={vaultNotes.get(vaultKey(item.vault))}
        onUndo={() => setPendingUndo(item)}
      />
    ) : (
      <FeedRow item={item} nowMs={nowMs} showVaultName={showVaultName} />
    );

  return (
    <FeedVaultNotesContext value={vaultNotes}>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
          <WorkspacePageHeader electron={isElectron} className="border-b border-border">
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1 [-webkit-app-region:no-drag]">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  size="sm"
                  checked={includeOwnChanges}
                  onCheckedChange={(checked) => setIncludeOwnChanges(checked)}
                />
                Show my own changes
              </label>
            </div>
          </WorkspacePageHeader>

          <ScrollArea className="min-h-0 flex-1">
            <WorkspacePageContainer className="gap-0">
              <PageTitle>Feed</PageTitle>
              {errors.map((error) => (
                <p key={error} className="mt-3 text-sm text-destructive-foreground">
                  {error}
                </p>
              ))}
              {brains.length > 0 ? (
                <div className="mt-3 flex flex-col" aria-label="Routines">
                  {brains.map((brain) => (
                    <RoutinesRunnerLine
                      key={brain.key}
                      runner={brain.runner}
                      runsOn={brain.runsOn}
                      moveTo={brain.moveTo}
                      title={showVaultName ? brain.runner.title : null}
                      onMove={setPendingMove}
                    />
                  ))}
                  {brains.map((brain) => (
                    <RoutinesBlockedLine
                      key={`blocked:${brain.key}`}
                      environmentId={brain.runner.environmentId}
                      status={brain.runner.history.routinesStatus}
                      machine={machineOf(brain.runner.environmentId)}
                      label={showVaultName ? brain.runner.title : null}
                    />
                  ))}
                  {brains.map((brain) => {
                    const line = memoryOverLimitLine(brain.runner.history.memoryOverLimit);
                    return line === null ? null : (
                      <StatusLine key={`memory:${brain.key}`} tone="warning" className="py-2.5">
                        {showVaultName ? `${brain.runner.title}: ` : ""}
                        {line}
                      </StatusLine>
                    );
                  })}
                  {vaults.map((vault) => (
                    <BackupStatusLine
                      key={`backup:${vault.environmentId}:${vault.projectId}`}
                      vault={vault}
                      label={copyLabel({
                        title: vault.title,
                        machine: vault.machine,
                        severalBrains: showVaultName,
                      })}
                    />
                  ))}
                </div>
              ) : null}
              {runItems.length > 0 ? (
                <Section label="Needs you">
                  <EntryList aria-label="Needs you">
                    {runItems.map((item) => (
                      <FeedRunRow
                        key={item.key}
                        item={item}
                        nowMs={nowMs}
                        showVaultName={showVaultName}
                      />
                    ))}
                  </EntryList>
                </Section>
              ) : null}
              {itemCount > 0 ? (
                <EntryList aria-label="Feed">
                  {timeline?.map(({ row, day }) => (
                    <Fragment key={row.key}>
                      {day === null ? null : <FeedDayHeading day={day} />}
                      {row.kind === "own-day" ? (
                        <FeedOwnDayRow day={row} nowMs={nowMs} showVaultName={showVaultName} />
                      ) : (
                        renderChange(row.item)
                      )}
                    </Fragment>
                  ))}
                  {grouped?.map(({ row, day }) => (
                    <Fragment key={row.key}>
                      {day === null ? null : <FeedDayHeading day={day} />}
                      {row.kind === "edits" ? (
                        <FeedEditGroupRow group={row} nowMs={nowMs} showVaultName={showVaultName} />
                      ) : (
                        renderChange(row.item)
                      )}
                    </Fragment>
                  ))}
                </EntryList>
              ) : runItems.length > 0 ? null : (
                <Section>
                  {loading ? (
                    <FeedSkeleton />
                  ) : vaults.length === 0 ? (
                    <FeedEmpty
                      title="No notes folder yet"
                      description="Open your notes folder in Majordome. Everything it changes there will show up here."
                    />
                  ) : (
                    <FeedEmpty
                      title="Nothing here yet"
                      description="Each time Majordome changes your notes, you'll see what it did here, and you can undo it."
                    />
                  )}
                </Section>
              )}
            </WorkspacePageContainer>
          </ScrollArea>
        </div>
        <UndoRunDialog item={pendingUndo} onClose={() => setPendingUndo(null)} />
        <MoveRoutinesDialog vault={pendingMove} onClose={() => setPendingMove(null)} />
      </SidebarInset>
    </FeedVaultNotesContext>
  );
}

/** The day a stretch of the feed happened on, as a section label inside the list. */
function FeedDayHeading({ day }: { readonly day: string }) {
  return (
    <li className="mt-8 mb-2 flex">
      <SectionLabel>{day}</SectionLabel>
    </li>
  );
}

function FeedRow({
  item,
  nowMs,
  showVaultName,
  onUndo,
}: {
  readonly item: FeedItem;
  readonly nowMs: number;
  readonly showVaultName: boolean;
  /** Left out for the owner's saves, which have nothing to undo. */
  readonly onUndo?: () => void;
}) {
  const canUndo = useAtomValue(
    majordomeEnvironment.undoVaultRun.permissionAtom(item.vault.environmentId),
  );
  const { entry } = item;
  const threadId = entry.threadId === null ? null : ThreadId.make(entry.threadId);
  const meta = [
    entry.byMajordome ? "Majordome" : entry.authorName,
    formatRelativeTimeLabel(entry.committedAt, nowMs),
    item.ownerEdit?.host ? `on ${item.ownerEdit.host}` : null,
    item.machine ? `on ${machineInSentence(item.machine)}` : null,
    showVaultName ? item.vault.title : null,
  ].filter((part) => part !== null && part !== "");
  const showUndo = onUndo !== undefined && entry.byMajordome && !item.undone && canUndo;

  return (
    <Entry
      data-feed-item={entry.commit}
      title={
        <span className={entry.byMajordome ? undefined : "text-muted-foreground"}>
          {item.title}
        </span>
      }
      aside={item.undone ? <Badge variant="secondary">Undone</Badge> : null}
      meta={meta.join(" · ")}
      actions={
        threadId !== null || showUndo ? (
          <>
            {threadId !== null ? (
              <OpenChatButton environmentId={item.vault.environmentId} threadId={threadId} />
            ) : null}
            {showUndo ? (
              <Button size="xs" variant="outline" onClick={onUndo}>
                <Undo2Icon />
                Undo this
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      <FeedNoteLinks vault={item.vault} files={entry.files} nowMs={nowMs} />
    </Entry>
  );
}

function FeedEditGroupRow({
  group,
  nowMs,
  showVaultName,
}: {
  readonly group: FeedEditGroup;
  readonly nowMs: number;
  readonly showVaultName: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [newest] = group.saves;
  const listId = `feed-saves-${group.key}`;
  const meta = [
    newest?.entry.authorName ?? null,
    newest ? formatRelativeTimeLabel(newest.entry.committedAt, nowMs) : null,
    group.hosts.length > 0 ? `on ${group.hosts.join(", ")}` : null,
    showVaultName ? group.vault.title : null,
  ].filter((part) => part !== null && part !== "");

  return (
    <Entry
      data-feed-edits={group.saves.length}
      title={<span className="text-muted-foreground">Your edits · {group.saves.length} saves</span>}
      meta={meta.join(" · ")}
      actions={
        <Button
          size="xs"
          variant="ghost-muted"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          {expanded ? "Hide saves" : "Show saves"}
        </Button>
      }
    >
      <FeedNoteLinks vault={group.vault} files={group.files} nowMs={nowMs} />
      {expanded ? (
        <EntryList id={listId} className="ms-4" aria-label="Saves">
          {group.saves.map((save) => (
            <FeedRow key={save.key} item={save} nowMs={nowMs} showVaultName={false} />
          ))}
        </EntryList>
      ) : null}
    </Entry>
  );
}

const vaultKey = (vault: FeedVault) => `${vault.environmentId}:${vault.projectId}`;

/** What the Feed knows about each vault's notes (titles, which still exist), by vault. */
const FeedVaultNotesContext = createContext<ReadonlyMap<string, FeedVaultNotes>>(new Map());

/** The notes a change touched, by title; each one that still exists opens in Notes. */
function FeedNoteLinks({
  vault,
  files,
  nowMs,
  withIcon = false,
}: {
  readonly vault: FeedVault;
  readonly files: ReadonlyArray<string>;
  readonly nowMs: number;
  readonly withIcon?: boolean;
}) {
  const notesByVault = useContext(FeedVaultNotesContext);
  const notes = feedNotes(files, notesByVault.get(vaultKey(vault)) ?? feedVaultNotes({}), nowMs);
  if (notes.shown.length === 0) return null;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
      {withIcon ? <NotebookPenIcon className="size-3.5 shrink-0" aria-hidden /> : null}
      {notes.shown.map((note, index) => (
        <span key={note.path} className="inline-flex min-w-0 items-center gap-x-1.5">
          {index > 0 ? <span aria-hidden>·</span> : null}
          {note.openable ? (
            <Link
              {...notesLink({
                projectId: vault.projectId,
                environmentId: vault.environmentId,
                path: note.path,
                from: "feed",
              })}
              className="max-w-56 truncate rounded-sm text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              data-feed-note={note.path}
            >
              {note.title}
            </Link>
          ) : (
            <span className="max-w-56 truncate" data-feed-note={note.path}>
              {note.title}
            </span>
          )}
        </span>
      ))}
      {notes.more > 0 ? <span>and {notes.more} more</span> : null}
    </p>
  );
}

const ROUTINE_ICONS: Record<MajordomeRoutineKind, LucideIcon> = {
  "start-my-day": SunriseIcon,
  "review-my-week": CalendarRangeIcon,
  "digest-my-inbox": InboxIcon,
  "tidy-my-memory": MoonIcon,
};

/** One run, told as an outcome: what it did in plain words, the notes it touched, and Undo. */
function FeedRunCard({
  item,
  nowMs,
  showVaultName,
  vaultNotes,
  onUndo,
}: {
  readonly item: FeedItem;
  readonly nowMs: number;
  readonly showVaultName: boolean;
  readonly vaultNotes: FeedVaultNotes | undefined;
  /** The run's chat is still there, so its notes can open beside it. */
  readonly onUndo: () => void;
}) {
  const canUndo = useAtomValue(
    majordomeEnvironment.undoVaultRun.permissionAtom(item.vault.environmentId),
  );
  const navigate = useNavigate();
  const { entry } = item;
  const notesInfo = vaultNotes ?? feedVaultNotes({});
  const kind = classifyFeedEntry(entry);
  const summary = kind === "run" ? feedRunSummary(entry, notesInfo) : null;
  const threadRef =
    entry.threadId === null
      ? null
      : scopeThreadRef(item.vault.environmentId, ThreadId.make(entry.threadId));
  const Icon =
    kind === "undo"
      ? Undo2Icon
      : entry.routine
        ? ROUTINE_ICONS[entry.routine]
        : entry.scheduled
          ? CalendarClockIcon
          : entry.threadId === null
            ? NotebookPenIcon
            : MessageSquareIcon;
  const meta = [
    formatRelativeTimeLabel(entry.committedAt, nowMs),
    item.machine ? `on ${machineInSentence(item.machine)}` : null,
    showVaultName ? item.vault.title : null,
  ].filter((part) => part !== null && part !== "");
  const undoable = !item.undone && canUndo;

  return (
    <Entry
      className={item.undone ? "opacity-70" : undefined}
      data-feed-item={entry.commit}
      data-feed-kind={kind}
      data-feed-routine={entry.routine ?? undefined}
      title={item.title}
      aside={item.undone ? <Badge variant="secondary">Undone</Badge> : null}
      meta={
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {meta.join(" · ")}
        </span>
      }
      actions={
        <Menu>
          <MenuTrigger
            render={<Button size="icon-xs" variant="ghost-muted" aria-label="More for this run" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {threadRef !== null ? (
              <MenuItem
                onClick={() =>
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(threadRef),
                  })
                }
              >
                <MessageSquareIcon />
                Open chat
              </MenuItem>
            ) : null}
            {undoable ? (
              <MenuItem onClick={onUndo}>
                <Undo2Icon />
                Undo this
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
      }
    >
      {summary !== null ? (
        <p
          className={cn(
            READING_MEASURE_CLASS,
            "line-clamp-3 leading-relaxed break-words text-foreground",
          )}
        >
          {summary}
        </p>
      ) : null}

      {entry.dailyNotePreview ? (
        <p
          className={cn(
            READING_MEASURE_CLASS,
            "line-clamp-6 border-s-2 border-border ps-3 leading-relaxed whitespace-pre-line text-muted-foreground",
          )}
          data-feed-daily-preview
        >
          {entry.dailyNotePreview}
        </p>
      ) : null}

      <FeedNoteLinks vault={item.vault} files={entry.files} nowMs={nowMs} withIcon />

      <Collapsible>
        <CollapsibleTrigger className="group -mx-2 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <ChevronRightIcon
            className="size-3.5 transition-transform group-data-[panel-open]:rotate-90"
            aria-hidden
          />
          Details
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="mt-1 flex flex-col gap-2 text-xs text-muted-foreground">
            {entry.files.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono break-all">
                {entry.files.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            ) : null}
            <p>
              Saved {formatFullTimestamp(entry.committedAt, "locale")} · {entry.commit.slice(0, 7)}
            </p>
            {undoable ? (
              <div>
                <Button size="xs" variant="outline" onClick={onUndo}>
                  <Undo2Icon />
                  Undo this
                </Button>
              </div>
            ) : null}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </Entry>
  );
}

/** The owner's own changes on one day, as one quiet line that opens to show them. */
function FeedOwnDayRow({
  day,
  nowMs,
  showVaultName,
}: {
  readonly day: FeedOwnDay;
  readonly nowMs: number;
  readonly showVaultName: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = `feed-own-${day.key}`;
  return (
    <Entry className="py-0" data-feed-own-day={day.items.length}>
      <button
        type="button"
        className={cn(
          ROW_ACTION_CLASS,
          "flex min-h-11 w-[calc(100%+1rem)] cursor-pointer items-center gap-2 text-start text-sm text-muted-foreground hover:text-foreground",
        )}
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">{ownDayLine(day, nowMs)}</span>
      </button>
      {expanded ? (
        <EntryList id={listId} className="ms-5" aria-label="Your edits">
          {groupFeedItems(day.items).map((row) =>
            row.kind === "edits" ? (
              <FeedEditGroupRow
                key={row.key}
                group={row}
                nowMs={nowMs}
                showVaultName={showVaultName}
              />
            ) : (
              <FeedRow key={row.key} item={row.item} nowMs={nowMs} showVaultName={showVaultName} />
            ),
          )}
        </EntryList>
      ) : null}
    </Entry>
  );
}

function OpenChatButton({
  environmentId,
  threadId,
  answer = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The chat holds a question to answer, so the button says so and stands out. */
  readonly answer?: boolean;
}) {
  return (
    <Button
      size="xs"
      variant={answer ? "outline" : "ghost-muted"}
      render={
        <Link
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(environmentId, threadId))}
        />
      }
    >
      <MessageSquareIcon />
      {answer ? "Answer in chat" : "Open chat"}
    </Button>
  );
}

function FeedRunRow({
  item,
  nowMs,
  showVaultName,
}: {
  readonly item: FeedRunItem;
  readonly nowMs: number;
  readonly showVaultName: boolean;
}) {
  const meta = [
    formatRelativeTimeLabel(item.at, nowMs),
    item.vault.machine ? `on ${machineInSentence(item.vault.machine)}` : null,
    showVaultName ? item.vault.title : null,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
  const answersInChat = item.status === "waiting" && item.ownerCardId === null;
  return (
    <Entry
      data-feed-run={item.status}
      title={item.title}
      meta={meta}
      actions={
        answersInChat ? undefined : (
          <OpenChatButton environmentId={item.vault.environmentId} threadId={item.threadId} />
        )
      }
    >
      <StatusLine tone={item.status === "waiting" ? "warning" : "error"}>
        <Link
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(item.vault.environmentId, item.threadId))}
          className="rounded-sm underline decoration-border underline-offset-4 outline-none hover:decoration-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {FEED_RUN_STATUS_LABELS[item.status]}
        </Link>
      </StatusLine>
      {answersInChat ? (
        <div>
          <OpenChatButton
            environmentId={item.vault.environmentId}
            threadId={item.threadId}
            answer
          />
        </div>
      ) : null}
      {item.ownerCardId !== null ? (
        <>
          <PrivateDocumentFeedRequest
            environmentId={item.vault.environmentId}
            threadId={item.threadId}
            turnItemId={item.ownerCardId}
          />
          <ApprovalFeedRequest
            environmentId={item.vault.environmentId}
            threadId={item.threadId}
            turnItemId={item.ownerCardId}
          />
        </>
      ) : null}
    </Entry>
  );
}

const RUNNER_COPY: Record<MajordomeRoutinesRunner, string> = {
  "this-server": "Routines run on this computer",
  "another-server": "Routines run on another computer",
  none: ROUTINES_NOWHERE_TEXT,
};

/**
 * One line per brain about its routines. `runner` is the copy on the server that runs them (or
 * the brain's first copy); "Move routines here" moves them to `moveTo`, the window's own copy.
 */
function RoutinesRunnerLine({
  runner,
  runsOn,
  moveTo,
  title,
  onMove,
}: {
  readonly runner: FeedVaultState;
  /** The runner's name, when the brain is on several servers. */
  readonly runsOn: string | null;
  readonly moveTo: FeedVaultState | null;
  readonly title: string | null;
  readonly onMove: (vault: FeedVaultState) => void;
}) {
  const canMove = useAtomValue(
    majordomeEnvironment.runRoutinesHere.permissionAtom((moveTo ?? runner).environmentId),
  );
  return (
    <div
      className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
      data-routines-runner={runner.routinesRunner}
    >
      <CalendarClockIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 basis-48">
        {title === null ? "" : `${title}: `}
        {runner.pausedRunsPerDay !== null
          ? routinesPausedText(runner.pausedRunsPerDay)
          : runsOn !== null
            ? `Routines run on ${machineInSentence(runsOn)}`
            : RUNNER_COPY[runner.routinesRunner]}
      </span>
      {runner.pausedRunsPerDay !== null ? (
        <Button size="xs" variant="outline" render={<Link to="/routines" />}>
          Change limits
        </Button>
      ) : null}
      {moveTo !== null && canMove ? (
        <Button size="xs" variant="outline" onClick={() => onMove(moveTo)}>
          Move routines here
        </Button>
      ) : null}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

function FeedEmpty({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

type UndoRefusal = Exclude<MajordomeVaultUndoResult, { readonly status: "undone" }>;

const REFUSAL_COPY: Record<UndoRefusal["status"], string> = {
  conflict: "Later changes touched these notes, so this can't be undone automatically.",
  "unsaved-changes": "Save or discard your edits to these notes first.",
  "not-found": "This change is no longer in your notes' history.",
};

function UndoRunDialog({
  item,
  onClose,
}: {
  readonly item: FeedItem | null;
  readonly onClose: () => void;
}) {
  return (
    <AlertDialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {item ? <UndoRunDialogPopup key={item.key} item={item} onClose={onClose} /> : null}
    </AlertDialog>
  );
}

function UndoRunDialogPopup({
  item,
  onClose,
}: {
  readonly item: FeedItem;
  readonly onClose: () => void;
}) {
  const undo = useAtomCommand(majordomeEnvironment.undoVaultRun, { label: "undo vault run" });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<UndoRefusal | null>(null);

  const confirm = async () => {
    setBusy(true);
    const result = await undo({
      environmentId: item.vault.environmentId,
      input: { projectId: item.vault.projectId, commit: item.entry.commit },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not undo this",
          description: error instanceof Error ? error.message : String(error),
        });
      }
      onClose();
      return;
    }
    if (result.value.status === "undone") {
      toastManager.add({ type: "success", title: "Undone", description: item.title });
      onClose();
      return;
    }
    setRefusal(result.value);
  };

  if (refusal !== null) {
    return (
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Can't undo this yet</AlertDialogTitle>
          <AlertDialogDescription>{REFUSAL_COPY[refusal.status]}</AlertDialogDescription>
          {"files" in refusal && refusal.files.length > 0 ? (
            <ul className="mt-2 list-disc ps-5 text-sm text-foreground">
              {refusal.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>OK</AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogPopup>
    );
  }

  return (
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>Undo “{item.title}”?</AlertDialogTitle>
        <AlertDialogDescription>
          Your notes go back to how they were before this change. The undo shows up in the feed, so
          you can undo it too.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
          Cancel
        </AlertDialogClose>
        <Button disabled={busy} onClick={() => void confirm()}>
          {busy && <Spinner size="sm" />}
          Undo this
        </Button>
      </AlertDialogFooter>
    </AlertDialogPopup>
  );
}
