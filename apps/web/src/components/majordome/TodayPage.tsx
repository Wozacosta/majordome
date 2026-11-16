import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { ArrowUpIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { useQuietThreadShells } from "../../state/entities";
import { vaultHistoriesAtom } from "../../state/majordome";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  buildFeedItems,
  buildFeedRunItems,
  FEED_RUN_STATUS_LABELS,
  feedVaultNotes,
  stoppedRunKeys,
} from "./feed.logic";
import { requestDraftSend } from "./pendingDraftSend";
import { greetingForHour, selectTodayRuns, type TodayRun, todayTitle } from "./today.logic";
import { TopicIconBadge } from "./TopicIcon";
import { type MajordomeVault, topicSubtitle, type VaultTopic } from "./topics.logic";
import { useOpenTopic } from "./useOpenTopic";

const SECTION_LABEL_CLASS = "mb-2 text-2xs font-semibold uppercase tracking-widest text-primary";
/** A row's clickable area: wider than its text, so the hover tint has room and the text stays aligned. */
const ROW_TARGET_CLASS =
  "-mx-2 block rounded-md px-2 py-3 outline-hidden hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/** The owner's day in the active notes folder: a place to write, what routines did, and their topics. */
export function TodayPage({ vault }: { readonly vault: MajordomeVault }) {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const now = new Date(nowMs);

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
            <p className="text-sm text-muted-foreground">{greetingForHour(now.getHours())}</p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {todayTitle(now)}
            </h1>
            <CaptureBox key={vault.key} vault={vault} />
            <TodayRoutines vault={vault} nowMs={nowMs} />
            {vault.topics.length > 0 ? <TodayTopics vault={vault} /> : null}
          </div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

/** Starts a conversation in the notes folder with what was typed, as the new-thread page does. */
function CaptureBox({ vault }: { readonly vault: MajordomeVault }) {
  const handleNewThread = useNewThreadHandler();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const prompt = text.trim();

  const submit = async () => {
    if (prompt === "" || sending) return;
    setSending(true);
    const opened = await handleNewThread(scopeProjectRef(vault.environmentId, vault.projectId), {
      prompt,
    }).catch((error: unknown) => {
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
    <form
      className="mt-6 flex items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-xs focus-within:border-ring"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="Write a note, or ask anything"
        placeholder="Write a note, or ask anything…"
        rows={1}
        value={text}
        disabled={sending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="field-sizing-content max-h-48 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-base text-foreground outline-hidden placeholder:text-muted-foreground sm:min-h-8 sm:py-1 sm:text-sm"
      />
      <Button type="submit" size="icon" aria-label="Send" disabled={prompt === "" || sending}>
        <ArrowUpIcon />
      </Button>
    </form>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="mt-8" aria-label={title}>
      <h2 className={SECTION_LABEL_CLASS}>{title}</h2>
      {children}
    </section>
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

  return (
    <Section title="From your routines">
      {runs.length > 0 ? (
        <ul className="m-0 list-none p-0">
          {runs.map((run) => (
            <RunRow key={run.key} run={run} nowMs={nowMs} />
          ))}
        </ul>
      ) : loading ? null : (
        <p className="border-t border-border py-3 text-sm text-muted-foreground">
          What your routines do will show here after they run.{" "}
          <Link
            to="/settings/scheduled-tasks"
            className="rounded-sm text-foreground underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
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

function TodayTopics({ vault }: { readonly vault: MajordomeVault }) {
  const openTopic = useOpenTopic(vault);
  const [opening, setOpening] = useState<string | null>(null);
  const open = async (topic: VaultTopic) => {
    if (opening !== null) return;
    setOpening(topic.id);
    if (!(await openTopic(topic))) setOpening(null);
  };
  return (
    <Section title="Pick up where you left off">
      <ul className="m-0 list-none p-0">
        {vault.topics.map((topic) => (
          <li key={topic.id} className="border-t border-border" data-today-topic={topic.id}>
            <button
              type="button"
              onClick={() => void open(topic)}
              className={cn(
                ROW_TARGET_CLASS,
                "flex w-[calc(100%+1rem)] cursor-pointer items-center gap-3 text-left",
              )}
            >
              <TopicIconBadge topic={topic} statusDotClass={null} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{topic.title}</span>
                <span className="truncate text-sm text-muted-foreground">
                  {topicSubtitle(topic)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
