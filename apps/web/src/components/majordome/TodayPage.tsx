import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { setMarkdownTaskChecked } from "@t3tools/shared/markdownTaskList";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, PaperclipIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { majordomeEnvironment, vaultHistoriesAtom } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  buildFeedItems,
  buildFeedRunItems,
  FEED_RUN_STATUS_LABELS,
  feedVaultNotes,
  stoppedRunKeys,
} from "./feed.logic";
import { useNoteSourceLinkOpener } from "./NotePreview";
import { noteDraftKey, NoteSaveProblem, NoteSaveStatus, useNoteEditing } from "./noteEditing";
import { NoteSourceEditor } from "./NoteSourceEditor";
import { notesLink } from "./notes.logic";
import { requestDraftSend } from "./pendingDraftSend";
import { RoutinesBlockedLine } from "./RoutinesBlockedLine";
import { plainDateTime, selectComingUp, untilWords } from "./routines.logic";
import {
  assistantNotSetUp,
  dateOfDay,
  dayKey,
  greetingForHour,
  openTasks,
  pickTodayStarter,
  selectTodayRuns,
  shiftDay,
  timeOfDay,
  TODAY_STARTERS,
  type TodayRun,
  todayTitle,
  weekOf,
} from "./today.logic";
import { todoDisplayText } from "./todos.logic";
import type { MajordomeVault } from "./topics.logic";
import { useMachineNames } from "./useMachineNames";
import { useVaultRoutines } from "./useVaultRoutines";

const SECTION_LABEL_CLASS = "mb-2 text-2xs font-semibold uppercase tracking-widest text-primary";
/** A row's clickable area: wider than its text, so the hover tint has room and the text stays aligned. */
const ROW_TARGET_CLASS =
  "-mx-2 block rounded-md px-2 py-3 outline-hidden hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

type TodayView = "overview" | "journal";

/**
 * The owner's day in the active notes folder. Overview is short: a place to ask, what the day's
 * note leaves to do, reminders and what routines did. Journal is the daily note, for any day.
 */
export function TodayPage({ vault }: { readonly vault: MajordomeVault }) {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const now = new Date(nowMs);
  const today = dayKey(now);
  const [view, setView] = useState<TodayView>("overview");
  // Null follows the calendar, so a page left open overnight moves on to the new day.
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const show = (next: string) => setPicked(next === today ? null : next);
  const shownDay = view === "journal" ? day : today;

  return (
    <SidebarInset
      {...workspaceAreaProps("home", 1, "Today")}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} />
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-184 px-5 pt-2 pb-12 sm:px-6 sm:pt-6">
            <p className="text-sm text-muted-foreground">
              {shownDay === today ? greetingForHour(now.getHours()) : "Journal"}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {todayTitle(dateOfDay(shownDay))}
            </h1>
            <div className="mt-4 flex">
              <ToggleGroup
                aria-label="View"
                value={[view]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "overview" || value === "journal") setView(value);
                }}
              >
                <Toggle value="overview">Overview</Toggle>
                <Toggle value="journal">Journal</Toggle>
              </ToggleGroup>
            </div>
            {view === "overview" ? (
              <>
                <AssistantSetupLine vault={vault} />
                <CaptureBox key={vault.key} vault={vault} />
                <TodayTasks
                  key={`${vault.key}:${today}`}
                  vault={vault}
                  day={today}
                  onOpenJournal={() => {
                    setPicked(null);
                    setView("journal");
                  }}
                />
                <ComingUp vault={vault} nowMs={nowMs} />
                <TodayRoutines vault={vault} nowMs={nowMs} />
              </>
            ) : (
              <>
                <WeekStrip day={day} today={today} onShow={show} />
                <DailyNote
                  key={`${vault.key}:${day}`}
                  vault={vault}
                  day={day}
                  isToday={day === today}
                />
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

const INLINE_LINK_CLASS =
  "rounded-sm text-foreground underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/** One quiet line while no AI account on the notes folder's computer can answer. */
function AssistantSetupLine({ vault }: { readonly vault: MajordomeVault }) {
  const providers = useEnvironmentProviders().get(vault.environmentId);
  if (!assistantNotSetUp(providers)) return null;
  return (
    <p className="mt-4 text-sm text-muted-foreground" data-assistant-not-set-up>
      The assistant isn't set up yet.{" "}
      <Link
        to="/settings/providers"
        search={{ environmentId: vault.environmentId }}
        className={INLINE_LINK_CLASS}
      >
        Finish setup
      </Link>
    </p>
  );
}

/** The week around the shown day, each day one press away, with a way to any other date. */
function WeekStrip({
  day,
  today,
  onShow,
}: {
  readonly day: string;
  readonly today: string;
  readonly onShow: (day: string) => void;
}) {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Previous week"
        onClick={() => onShow(shiftDay(day, -7))}
      >
        <ChevronLeftIcon />
      </Button>
      {weekOf(day).map((key) => (
        <Button
          key={key}
          type="button"
          size="sm"
          variant={key === day ? "secondary" : "ghost"}
          aria-pressed={key === day}
          aria-label={todayTitle(dateOfDay(key))}
          onClick={() => onShow(key)}
        >
          <span className={cn(key === today && "font-semibold text-primary")}>
            {weekday.format(dateOfDay(key))} {dateOfDay(key).getDate()}
          </span>
        </Button>
      ))}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Next week"
        onClick={() => onShow(shiftDay(day, 7))}
      >
        <ChevronRightIcon />
      </Button>
      <div className="ms-auto flex items-center gap-1">
        {day === today ? null : (
          <Button type="button" size="sm" variant="outline" onClick={() => onShow(today)}>
            Today
          </Button>
        )}
        <div className="w-38">
          <Input
            nativeInput
            type="date"
            aria-label="Go to a day"
            value={day}
            onChange={(event) => {
              if (event.target.value !== "") onShow(event.target.value);
            }}
          />
        </div>
      </div>
    </div>
  );
}

const TODAY_TASKS_SHOWN = 6;

/** What today's note still leaves to do, to tick without opening the note; nothing when it has none. */
function TodayTasks({
  vault,
  day,
  onOpenJournal,
}: {
  readonly vault: MajordomeVault;
  readonly day: string;
  readonly onOpenJournal: () => void;
}) {
  const { environmentId, projectId } = vault;
  const note = AsyncResult.getOrElse(
    useAtomValue(
      majordomeEnvironment.dailyNote({ environmentId, input: { projectId, date: day } }),
    ),
    () => null,
  );
  const canWrite = useAtomValue(majordomeEnvironment.saveDailyNote.permissionAtom(environmentId));
  const saveNote = useAtomCommand(majordomeEnvironment.saveDailyNote, {
    label: "tick daily note to-do",
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const content = note?.content ?? null;
  const tasks = content === null ? [] : openTasks(content);
  if (content === null || tasks.length === 0) return null;

  const tick = async (markerOffset: number) => {
    if (busy) return;
    setBusy(true);
    const outcome = await saveNote({
      environmentId,
      input: {
        projectId,
        date: day,
        content: setMarkdownTaskChecked(content, markerOffset, true),
        base: content,
      },
    });
    setBusy(false);
    reportFailure(outcome, "Could not tick that");
  };

  return (
    <Section title="To do today">
      <ul className="m-0 list-none p-0">
        {tasks.slice(0, TODAY_TASKS_SHOWN).map((task) => (
          <li key={task.markerOffset} className="border-t border-border" data-today-task>
            <label className="flex min-h-10 cursor-pointer items-start gap-2.5 py-2.5">
              <span className="flex h-5 shrink-0 items-center">
                <Checkbox
                  checked={false}
                  disabled={!canWrite || busy}
                  onCheckedChange={() => void tick(task.markerOffset)}
                />
              </span>
              <span className="min-w-0 flex-1 text-sm wrap-break-word text-foreground">
                {todoDisplayText(task.text)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="border-t border-border pt-2">
        <Button type="button" size="xs" variant="ghost" onClick={onOpenJournal}>
          {tasks.length > TODAY_TASKS_SHOWN
            ? `${tasks.length - TODAY_TASKS_SHOWN} more in today's note`
            : "Open today's note"}
        </Button>
      </div>
    </Section>
  );
}

function reportFailure(result: AtomCommandResult<unknown, unknown>, title: string): boolean {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return false;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
  return true;
}

/** One day's note from the daily folder, written in place and saved as it is typed. */
function DailyNote({
  vault,
  day,
  isToday,
}: {
  readonly vault: MajordomeVault;
  readonly day: string;
  readonly isToday: boolean;
}) {
  const { environmentId, projectId } = vault;
  const result = useAtomValue(
    majordomeEnvironment.dailyNote({ environmentId, input: { projectId, date: day } }),
  );
  const note = AsyncResult.getOrElse(result, () => null);
  if (note === null) {
    return result._tag === "Failure" ? (
      <p className="mt-6 text-sm text-muted-foreground">This day's note could not be read.</p>
    ) : (
      <div className="mt-6" aria-hidden>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return <DailyNoteCard key={day} vault={vault} day={day} isToday={isToday} note={note} />;
}

function DailyNoteCard({
  vault,
  day,
  isToday,
  note,
}: {
  readonly vault: MajordomeVault;
  readonly day: string;
  readonly isToday: boolean;
  readonly note: { readonly path: string; readonly content: string | null };
}) {
  const { environmentId, projectId } = vault;
  const workspaceRoot =
    useProjects().find(
      (project) => project.environmentId === environmentId && project.id === projectId,
    )?.workspaceRoot ?? "";
  const canWrite = useAtomValue(majordomeEnvironment.saveDailyNote.permissionAtom(environmentId));
  const saveNote = useAtomCommand(majordomeEnvironment.saveDailyNote, {
    label: "save daily note",
    reportFailure: false,
  });
  const addLine = useAtomCommand(majordomeEnvironment.addToDailyNote, {
    label: "add to daily note",
    reportFailure: false,
  });
  const disk = note.content;
  const [line, setLine] = useState("");
  const [adding, setAdding] = useState(false);
  const editing = useNoteEditing({
    draftKey: noteDraftKey(vault, note.path),
    disk,
    save: (content, base) =>
      saveNote({ environmentId, input: { projectId, date: day, content, base } }),
  });

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const text = line.trim();
    if (text === "" || adding) return;
    setAdding(true);
    if (!(await editing.flush())) {
      setAdding(false);
      return;
    }
    const outcome = await addLine({
      environmentId,
      input: { projectId, date: day, time: timeOfDay(new Date()), text },
    });
    setAdding(false);
    if (!reportFailure(outcome, "Could not add that to the note")) setLine("");
  };

  const openLink = useNoteSourceLinkOpener({
    vault: { environmentId, projectId, title: vault.title, workspaceRoot },
    path: note.path,
    text: editing.view.draft ?? disk ?? "",
    noteLink: (path) => notesLink({ projectId, environmentId, path }),
  });

  return (
    <section className="mt-6" aria-label="Daily note" data-daily-note={day}>
      {isToday && canWrite ? (
        <form onSubmit={(event) => void add(event)}>
          <Input
            nativeInput
            size="lg"
            aria-label="Add a line to today's note"
            placeholder="Add a line to today's note…"
            maxLength={2000}
            value={line}
            disabled={adding}
            onChange={(event) => setLine(event.target.value)}
          />
        </form>
      ) : null}
      <div className="mt-3 rounded-2xl border border-border bg-card p-5 shadow-xs">
        <NoteSaveProblem editing={editing} className="mb-3" />
        {!canWrite && (disk === null || disk.trim() === "") ? (
          <p className="text-sm text-muted-foreground">Nothing written for this day yet.</p>
        ) : (
          <NoteSourceEditor
            value={editing.view.draft ?? disk ?? ""}
            held={editing.held}
            editable={canWrite}
            placeholder="Nothing written for this day yet. Click here to write."
            ariaLabel="This day's note"
            onChange={editing.change}
            onBlur={() => void editing.flush()}
            onOpenLink={openLink}
          />
        )}
        <NoteSaveStatus view={editing.view} className="mt-3" />
      </div>
    </section>
  );
}

/** Starts a conversation in the notes folder with what was typed, as the new-thread page does. */
function CaptureBox({ vault }: { readonly vault: MajordomeVault }) {
  const handleNewThread = useNewThreadHandler();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);

  /** With files, the conversation opens holding them and the words, for the owner to send. */
  const submit = async (files: ReadonlyArray<File> = [], given?: string) => {
    const prompt = given ?? text.trim();
    if ((prompt === "" && files.length === 0) || sending) return;
    setSending(true);
    const opened = await handleNewThread(
      scopeProjectRef(vault.environmentId, vault.projectId),
      prompt === "" ? {} : { prompt },
    ).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not start the conversation",
        description: error instanceof Error ? error.message : undefined,
      });
      return null;
    });
    if (opened === null) {
      setSending(false);
      return;
    }
    if (files.length > 0) {
      requestDraftSend(opened.draftId, files);
      return;
    }
    // A draft that already held other text kept it; that one is the owner's to send.
    if (useComposerDraftStore.getState().getComposerDraft(opened.draftId)?.prompt === prompt) {
      requestDraftSend(opened.draftId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  return (
    <>
      <form
        className="mt-6 flex flex-col rounded-2xl border border-border bg-card p-2 shadow-xs focus-within:border-ring"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          void submit([...event.dataTransfer.files]);
        }}
      >
        <textarea
          ref={textArea}
          aria-label="Ask anything, or tell me what to remember"
          placeholder="Ask anything, or tell me what to remember…"
          rows={3}
          // Today is where a day starts, and typing is what it is for.
          autoFocus
          value={text}
          disabled={sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            if (event.clipboardData.files.length === 0) return;
            event.preventDefault();
            void submit([...event.clipboardData.files]);
          }}
          className="field-sizing-content max-h-64 min-h-20 min-w-0 resize-none bg-transparent px-2 py-1.5 text-base text-foreground outline-hidden placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              void submit(files);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={sending}
            onClick={() => fileInput.current?.click()}
          >
            <PaperclipIcon />
            Add a file or picture
          </Button>
          <Button
            type="submit"
            size="icon"
            aria-label="Send"
            disabled={text.trim() === "" || sending}
          >
            <ArrowUpIcon />
          </Button>
        </div>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {TODAY_STARTERS.map((starter) => (
          <Button
            key={starter.label}
            type="button"
            size="xs"
            variant="outline"
            disabled={sending}
            onClick={() => {
              const picked = pickTodayStarter(text, starter);
              setText(picked.text);
              if (picked.send) void submit([], picked.text.trim());
              else textArea.current?.focus();
            }}
          >
            {starter.label}
          </Button>
        ))}
      </div>
    </>
  );
}

function Section({
  title,
  action,
  children,
}: {
  readonly title: string;
  /** Quiet links beside the heading, to the screens this section is a glimpse of. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="mt-8" aria-label={title}>
      <div className="flex items-baseline gap-3">
        <h2 className={cn(SECTION_LABEL_CLASS, "min-w-0 flex-1")}>{title}</h2>
        {action ? (
          <span className="flex shrink-0 items-baseline gap-3 text-xs text-muted-foreground">
            {action}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** The next few reminders, each leading to the Routines screen; nothing when none is coming. */
function ComingUp({ vault, nowMs }: { readonly vault: MajordomeVault; readonly nowMs: number }) {
  const reminders = selectComingUp(useVaultRoutines(vault).reminders);
  if (reminders.length === 0) return null;
  return (
    <Section title="Coming up">
      <ul className="m-0 list-none p-0">
        {reminders.map(({ key, task }) => (
          <li key={key} className="border-t border-border" data-today-reminder={task.title}>
            <Link to="/reminders" className={cn(ROW_TARGET_CLASS, "flex items-baseline gap-2")}>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {task.title}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {plainDateTime(task.nextRunAt ?? "")} · {untilWords(task.nextRunAt ?? "", nowMs)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The newest results from the Feed, for the active notes folder on every server that has it. */
function TodayRoutines({
  vault,
  nowMs,
}: {
  readonly vault: MajordomeVault;
  readonly nowMs: number;
}) {
  const results = useAtomValue(
    vaultHistoriesAtom(
      JSON.stringify(vault.copies.map((copy) => [copy.environmentId, copy.projectId])),
    ),
  );
  const threads = useQuietThreadShells();
  const { machineOf } = useMachineNames();
  const copies = vault.copies.flatMap((copy, index) => {
    const result = results[index];
    const history = result === undefined ? null : AsyncResult.getOrElse(result, () => null);
    return history?.isVault
      ? [{ vault: { ...copy, title: vault.title, brainKey: vault.key }, history }]
      : [];
  });
  const vaults = copies.map((copy) => copy.vault);
  const runs = selectTodayRuns({
    attention: buildFeedRunItems(
      threads,
      vaults,
      stoppedRunKeys(
        copies.map((copy) => ({
          environmentId: copy.vault.environmentId,
          stoppedRuns: copy.history.stoppedRuns ?? [],
        })),
      ),
    ),
    changes: buildFeedItems(
      copies.map((copy) => ({ vault: copy.vault, entries: copy.history.entries })),
      {
        includeOwnChanges: false,
        knownThreads: new Set(threads.map((thread) => `${thread.environmentId}:${thread.id}`)),
      },
    ),
    notesOf: (runVault) =>
      feedVaultNotes(
        copies.find(
          (copy) =>
            copy.vault.environmentId === runVault.environmentId &&
            copy.vault.projectId === runVault.projectId,
        )?.history ?? {},
      ),
    topicThreads: new Set(
      vault.topics.flatMap((topic) =>
        topic.threadId === null ? [] : [`${topic.threadEnvironmentId}:${topic.threadId}`],
      ),
    ),
  });
  // Until every server has answered, an empty list may only mean "not known yet".
  const loading = results.some((result) => result._tag === "Initial");
  const failed = results.some((result) => result._tag === "Failure");

  return (
    <Section
      title="Lately in your notes"
      action={
        <>
          <Link to="/notes" className={INLINE_LINK_CLASS}>
            All notes
          </Link>
          <Link to="/feed" className={INLINE_LINK_CLASS}>
            Everything it did
          </Link>
        </>
      }
    >
      {copies.map((copy) => (
        <RoutinesBlockedLine
          key={copy.vault.environmentId}
          environmentId={copy.vault.environmentId}
          status={copy.history.routinesStatus}
          machine={machineOf(copy.vault.environmentId)}
          label={null}
        />
      ))}
      {runs.length > 0 ? (
        <ul className="m-0 list-none p-0">
          {runs.map((run) => (
            <RunRow key={run.key} run={run} nowMs={nowMs} />
          ))}
        </ul>
      ) : loading ? null : failed ? (
        <p className="border-t border-border py-3 text-sm text-muted-foreground">
          Couldn't load what happened in your notes. Open this page again to retry.
        </p>
      ) : (
        <p className="border-t border-border py-3 text-sm text-muted-foreground">
          Routines are things Majordome does for you on its own, at times you choose. What they do
          shows here after they run.{" "}
          <Link to="/routines" className={INLINE_LINK_CLASS}>
            See your routines
          </Link>
        </p>
      )}
    </Section>
  );
}

function RunRow({ run, nowMs }: { readonly run: TodayRun; readonly nowMs: number }) {
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{run.title}</span>
        {run.status !== null ? (
          <Badge variant={run.status === "waiting" ? "warning" : "error"}>
            {FEED_RUN_STATUS_LABELS[run.status]}
          </Badge>
        ) : null}
        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
          {formatRelativeTimeLabel(run.at, nowMs)}
        </span>
      </span>
      {run.summary ? (
        <span className="mt-0.5 line-clamp-3 text-sm break-words text-muted-foreground">
          {run.summary}
        </span>
      ) : null}
    </>
  );
  return (
    <li className="border-t border-border" data-today-run={run.status ?? "done"}>
      {run.threadId === null ? (
        <div className="py-3">{content}</div>
      ) : (
        <Link
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(run.environmentId, run.threadId))}
          className={ROW_TARGET_CLASS}
        >
          {content}
        </Link>
      )}
    </li>
  );
}
