import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
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
  CircleAlertIcon,
  EllipsisIcon,
  HandIcon,
  InboxIcon,
  MessageSquareIcon,
  NotebookPenIcon,
  SunriseIcon,
  Undo2Icon,
} from "lucide-react";
import { createContext, useContext, useState } from "react";

import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { majordomeEnvironment, vaultHistoriesAtom } from "../../state/majordome";
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
  ownDayLine,
  type FeedRunItem,
  type FeedVault,
  stoppedRunKeys,
} from "./feed.logic";
import { BackupStatusLine } from "./BackupStatusLine";
import { notesLink } from "./notes.logic";

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
  const results = useAtomValue(
    vaultHistoriesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );

  const threads = useQuietThreadShells();
  const vaults: Array<FeedVaultState> = [];
  const histories: Array<{
    vault: FeedVault;
    entries: MajordomeVaultHistoryResult["entries"];
  }> = [];
  const vaultNotes = new Map<string, FeedVaultNotes>();
  const errors: Array<string> = [];
  let loading = false;
  projects.forEach((project, index) => {
    const result = results[index];
    if (result === undefined || result._tag === "Initial") {
      loading = true;
      return;
    }
    if (result._tag === "Failure") {
      errors.push(`${project.title}: ${formatEnvironmentQueryError(result.cause)}`);
    }
    const history = AsyncResult.getOrElse(result, () => null);
    if (history?.isVault) {
      const vault = {
        environmentId: project.environmentId,
        projectId: project.id,
        title: project.title,
      };
      vaults.push({
        ...vault,
        routinesRunner: history.routinesRunner,
        pausedRunsPerDay: history.pausedToday ? (history.routineLimits?.runsPerDay ?? null) : null,
        stoppedRuns: history.stoppedRuns ?? [],
      });
      histories.push({ vault, entries: history.entries });
      vaultNotes.set(vaultKey(vault), feedVaultNotes(history));
    }
  });
  const runItems = buildFeedRunItems(threads, vaults, stoppedRunKeys(vaults));
  const changes = buildFeedItems(histories, { includeOwnChanges: true });
  const timeline = includeOwnChanges ? null : foldOwnChanges(changes);
  const grouped = includeOwnChanges ? groupFeedItems(changes) : null;
  const itemCount = timeline?.length ?? grouped?.length ?? 0;
  const showVaultName = histories.length > 1;
  const renderChange = (item: FeedItem) =>
    item.entry.byMajordome ? (
      <FeedRunCard
        key={item.key}
        item={item}
        nowMs={nowMs}
        showVaultName={showVaultName}
        vaultNotes={vaultNotes.get(vaultKey(item.vault))}
        onUndo={() => setPendingUndo(item)}
      />
    ) : (
      <FeedRow key={item.key} item={item} nowMs={nowMs} showVaultName={showVaultName} />
    );

  return (
    <FeedVaultNotesContext value={vaultNotes}>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
          <WorkspacePageHeader electron={isElectron} className="border-b border-border">
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Feed</h1>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 [-webkit-app-region:no-drag]">
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
            <WorkspacePageContainer>
              {errors.map((error) => (
                <p key={error} className="text-sm text-destructive-foreground">
                  {error}
                </p>
              ))}
              {vaults.length > 0 ? (
                <div className="mb-3 flex flex-col gap-1" aria-label="Routines">
                  {vaults.map((vault) => (
                    <RoutinesRunnerLine
                      key={`${vault.environmentId}:${vault.projectId}`}
                      vault={vault}
                      showVaultName={vaults.length > 1}
                      onMove={() => setPendingMove(vault)}
                    />
                  ))}
                  {vaults.map((vault) => (
                    <BackupStatusLine
                      key={`backup:${vault.environmentId}:${vault.projectId}`}
                      vault={vault}
                      showVaultName={vaults.length > 1}
                    />
                  ))}
                </div>
              ) : null}
              {runItems.length > 0 ? (
                <ul className="m-0 mb-1 flex list-none flex-col gap-1 p-0" aria-label="Needs you">
                  {runItems.map((item) => (
                    <FeedRunRow
                      key={item.key}
                      item={item}
                      nowMs={nowMs}
                      showVaultName={showVaultName}
                    />
                  ))}
                </ul>
              ) : null}
              {itemCount > 0 ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Feed">
                  {timeline?.map((row) =>
                    row.kind === "own-day" ? (
                      <FeedOwnDayRow
                        key={row.key}
                        day={row}
                        nowMs={nowMs}
                        showVaultName={showVaultName}
                      />
                    ) : (
                      renderChange(row.item)
                    ),
                  )}
                  {grouped?.map((row) =>
                    row.kind === "edits" ? (
                      <FeedEditGroupRow
                        key={row.key}
                        group={row}
                        nowMs={nowMs}
                        showVaultName={showVaultName}
                      />
                    ) : (
                      renderChange(row.item)
                    ),
                  )}
                </ul>
              ) : runItems.length > 0 ? null : loading ? (
                <FeedSkeleton />
              ) : histories.length === 0 ? (
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
            </WorkspacePageContainer>
          </ScrollArea>
        </div>
        <UndoRunDialog item={pendingUndo} onClose={() => setPendingUndo(null)} />
        <MoveRoutinesDialog vault={pendingMove} onClose={() => setPendingMove(null)} />
      </SidebarInset>
    </FeedVaultNotesContext>
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
    showVaultName ? item.vault.title : null,
  ].filter((part) => part !== null && part !== "");

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg px-3 py-2.5",
        entry.byMajordome ? "hover:bg-accent/40" : "opacity-70",
      )}
      data-feed-item={entry.commit}
    >
      <NotebookPenIcon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          entry.byMajordome ? "text-foreground/70" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "truncate text-sm",
              entry.byMajordome ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {item.title}
          </span>
          {item.undone ? <Badge variant="secondary">Undone</Badge> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
        <FeedNoteLinks vault={item.vault} files={entry.files} nowMs={nowMs} className="mt-1" />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {threadId !== null ? (
          <OpenChatButton environmentId={item.vault.environmentId} threadId={threadId} />
        ) : null}
        {onUndo && entry.byMajordome && !item.undone && canUndo ? (
          <Button size="xs" variant="outline" onClick={onUndo}>
            <Undo2Icon />
            Undo this
          </Button>
        ) : null}
      </div>
    </li>
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
    <li className="flex flex-col" data-feed-edits={group.saves.length}>
      <div className="flex items-start gap-3 rounded-lg px-3 py-2.5 opacity-70">
        <NotebookPenIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-muted-foreground">
            Your edits · {group.saves.length} saves
          </p>
          <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
          <FeedNoteLinks vault={group.vault} files={group.files} nowMs={nowMs} className="mt-1" />
        </div>
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
      </div>
      {expanded ? (
        <ul id={listId} className="m-0 ms-7 flex list-none flex-col p-0" aria-label="Saves">
          {group.saves.map((save) => (
            <FeedRow key={save.key} item={save} nowMs={nowMs} showVaultName={false} />
          ))}
        </ul>
      ) : null}
    </li>
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
  className,
  withIcon = false,
}: {
  readonly vault: FeedVault;
  readonly files: ReadonlyArray<string>;
  readonly nowMs: number;
  readonly className?: string;
  readonly withIcon?: boolean;
}) {
  const notesByVault = useContext(FeedVaultNotesContext);
  const notes = feedNotes(files, notesByVault.get(vaultKey(vault)) ?? feedVaultNotes({}), nowMs);
  if (notes.shown.length === 0) return null;
  return (
    <p
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {withIcon ? <NotebookPenIcon className="me-0.5 size-3.5 shrink-0" aria-hidden /> : null}
      {notes.shown.map((note, index) => (
        <span key={note.path} className="inline-flex min-w-0 items-center gap-x-1">
          {index > 0 ? <span aria-hidden>·</span> : null}
          {note.openable ? (
            <Link
              {...notesLink({
                projectId: vault.projectId,
                environmentId: vault.environmentId,
                path: note.path,
                from: "feed",
              })}
              className="max-w-56 truncate text-foreground underline-offset-2 hover:underline"
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

const ROUTINE_ICONS = {
  "start-my-day": SunriseIcon,
  "review-my-week": CalendarRangeIcon,
  "digest-my-inbox": InboxIcon,
} as const;

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
        : entry.threadId === null
          ? NotebookPenIcon
          : MessageSquareIcon;
  const meta = [
    formatRelativeTimeLabel(entry.committedAt, nowMs),
    showVaultName ? item.vault.title : null,
  ].filter((part) => part !== null && part !== "");
  const undoable = !item.undone && canUndo;

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-card px-3.5 py-3",
        item.undone && "opacity-70",
      )}
      data-feed-item={entry.commit}
      data-feed-kind={kind}
      data-feed-routine={entry.routine ?? undefined}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-foreground/70" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
            {item.undone ? <Badge variant="secondary">Undone</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
        </div>
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
      </div>

      {summary !== null ? (
        <p className="ms-7 line-clamp-3 text-sm break-words text-foreground/90">{summary}</p>
      ) : null}

      {entry.dailyNotePreview ? (
        <p
          className="ms-7 line-clamp-6 rounded-lg bg-muted/60 px-3 py-2 text-xs whitespace-pre-line text-muted-foreground"
          data-feed-daily-preview
        >
          {entry.dailyNotePreview}
        </p>
      ) : null}

      <FeedNoteLinks
        vault={item.vault}
        files={entry.files}
        nowMs={nowMs}
        className="ms-7"
        withIcon
      />

      <Collapsible className="ms-7">
        <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRightIcon
            className="size-3.5 transition-transform group-data-[panel-open]:rotate-90"
            aria-hidden
          />
          Details
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="mt-2 flex flex-col gap-2 text-xs text-muted-foreground">
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
    </li>
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
    <li className="flex flex-col" data-feed-own-day={day.items.length}>
      <button
        type="button"
        className="flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-start text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground"
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
        <ul id={listId} className="m-0 ms-4 flex list-none flex-col p-0" aria-label="Your edits">
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
        </ul>
      ) : null}
    </li>
  );
}

function OpenChatButton({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  return (
    <Button
      size="xs"
      variant="ghost-muted"
      render={
        <Link
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(environmentId, threadId))}
        />
      }
    >
      <MessageSquareIcon />
      Open chat
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
  const Icon = item.status === "waiting" ? HandIcon : CircleAlertIcon;
  const meta = [formatRelativeTimeLabel(item.at, nowMs), showVaultName ? item.vault.title : null]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
  return (
    <li
      className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/40"
      data-feed-run={item.status}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          item.status === "waiting" ? "text-warning-foreground" : "text-destructive-foreground",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
          <Badge variant={item.status === "waiting" ? "warning" : "error"}>
            {FEED_RUN_STATUS_LABELS[item.status]}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">{meta}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <OpenChatButton environmentId={item.vault.environmentId} threadId={item.threadId} />
      </div>
    </li>
  );
}

const RUNNER_COPY: Record<MajordomeRoutinesRunner, string> = {
  "this-server": "Routines run on this computer",
  "another-server": "Routines run on another computer",
  none: "Routines don't run on any computer yet",
};

function RoutinesRunnerLine({
  vault,
  showVaultName,
  onMove,
}: {
  readonly vault: FeedVaultState;
  readonly showVaultName: boolean;
  readonly onMove: () => void;
}) {
  const canMove = useAtomValue(
    majordomeEnvironment.runRoutinesHere.permissionAtom(vault.environmentId),
  );
  return (
    <div
      className="flex min-h-7 items-center gap-2 px-3 text-xs text-muted-foreground"
      data-routines-runner={vault.routinesRunner}
    >
      <CalendarClockIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {showVaultName ? `${vault.title}: ` : ""}
        {vault.pausedRunsPerDay !== null
          ? `Routines are paused until tomorrow: they used today's ${vault.pausedRunsPerDay} runs`
          : RUNNER_COPY[vault.routinesRunner]}
      </span>
      {vault.pausedRunsPerDay !== null ? (
        <Button size="xs" variant="outline" render={<Link to="/settings/scheduled-tasks" />}>
          Change limits
        </Button>
      ) : null}
      {vault.routinesRunner !== "this-server" && canMove ? (
        <Button size="xs" variant="outline" onClick={onMove}>
          Move routines here
        </Button>
      ) : null}
    </div>
  );
}

function MoveRoutinesDialog({
  vault,
  onClose,
}: {
  readonly vault: FeedVaultState | null;
  readonly onClose: () => void;
}) {
  return (
    <AlertDialog
      open={vault !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {vault ? (
        <MoveRoutinesDialogPopup
          key={`${vault.environmentId}:${vault.projectId}`}
          vault={vault}
          onClose={onClose}
        />
      ) : null}
    </AlertDialog>
  );
}

function MoveRoutinesDialogPopup({
  vault,
  onClose,
}: {
  readonly vault: FeedVaultState;
  readonly onClose: () => void;
}) {
  const runHere = useAtomCommand(majordomeEnvironment.runRoutinesHere, {
    label: "run routines here",
  });
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    const result = await runHere({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not move routines here",
          description: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      toastManager.add({ type: "success", title: "Routines now run on this computer" });
    }
    onClose();
  };

  return (
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>Move routines to this computer?</AlertDialogTitle>
        <AlertDialogDescription>
          Your routines for {vault.title}, and digesting new files in your inbox, will run on this
          computer from now on.
          {vault.routinesRunner === "another-server"
            ? " The other computer stops running them once it gets your latest notes."
            : ""}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
          Cancel
        </AlertDialogClose>
        <Button disabled={busy} onClick={() => void confirm()}>
          {busy && <Spinner size="sm" />}
          Move routines here
        </Button>
      </AlertDialogFooter>
    </AlertDialogPopup>
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
