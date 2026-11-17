import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Link, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { ChatComposerHandle } from "../chat/ChatComposer";
import { ComposerHandleContext, type ComposerHandleRef } from "../../composerHandleContext";
import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { newThreadId } from "../../lib/utils";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import { useQuietThreadShell } from "../../state/entities";
import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { ScreenContextReader } from "../chat/screenContext";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import {
  assistantConversationActivity,
  assistantScreenName,
  isAssistantConversationStale,
  screenContextRecord,
} from "./assistant.logic";
import { HEADING_CLASS, Muted, ROW_ACTION_CLASS, StatusLine } from "./paper";
import { notePendingAssistantThread } from "./pendingAssistantThreads";
import type { VaultCopy } from "./topics.logic";

// The panel has no diff panel or terminal of its own; the full conversation does.
const NO_PARENT_PANEL: SideChatParentPanel = {
  openToolDiff: () => {},
  runShellCommand: () => {},
};

// Two panels can show the same conversation at once; only one of them replaces it.
const replacedStaleThreads = new Set<string>();

/**
 * The assistant beside a page: the notes folder's one setup conversation, on the server that runs
 * its routines, shown with the app's own conversation view.
 */
export function RoutinesAssistant({
  copy,
  composerRef,
  hint,
  back,
}: {
  /** The notes folder's copy on the server that runs its routines. */
  readonly copy: VaultCopy;
  readonly composerRef?: ComposerHandleRef;
  readonly hint: string;
  /** On a narrow screen the assistant covers the page; this control goes back to it. */
  readonly back?: ReactNode;
}) {
  const ownComposerRef = useRef<ChatComposerHandle | null>(null);
  const { environmentId, projectId, routinesThreadId } = copy;
  const canOpen = useAtomValue(
    majordomeEnvironment.openRoutinesConversation.permissionAtom(environmentId),
  );
  const open = useAtomCommand(majordomeEnvironment.openRoutinesConversation, {
    label: "open the routines conversation",
    reportFailure: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shell = useQuietThreadShell(
    routinesThreadId === null ? null : scopeThreadRef(environmentId, routinesThreadId),
  );

  /** Resolves to why the conversation could not be opened, or null when it was. */
  const request = useStableCallback(async (fresh: boolean) => {
    const threadId = newThreadId();
    notePendingAssistantThread(environmentId, threadId);
    const result = await open({ environmentId, input: { projectId, fresh, threadId } });
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
    const failure = squashAtomCommandFailure(result);
    return failure instanceof Error ? failure.message : String(failure);
  });
  const start = async (fresh: boolean) => {
    setBusy(true);
    setError(await request(fresh));
    setBusy(false);
  };

  const missing = routinesThreadId === null && canOpen && error === null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the server for the notes folder's routines conversation, which it starts the first time this screen is shown
  useEffect(() => {
    if (!missing) return;
    let current = true;
    void request(false).then((failure) => {
      if (current && failure !== null) setError(failure);
    });
    return () => {
      current = false;
    };
  }, [missing, request]);

  const staleChecked = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- once, when the panel first shows the conversation: asks the server for a fresh one when this one was left idle for days
  useEffect(() => {
    if (staleChecked.current || routinesThreadId === null || shell === null || !canOpen) return;
    staleChecked.current = true;
    const threadRef = scopeThreadRef(environmentId, routinesThreadId);
    const key = `${environmentId}:${routinesThreadId}`;
    if (
      replacedStaleThreads.has(key) ||
      composerDraftHasUserContent(useComposerDraftStore.getState().getComposerDraft(threadRef)) ||
      !isAssistantConversationStale({ ...assistantConversationActivity(shell), now: Date.now() })
    ) {
      return;
    }
    replacedStaleThreads.add(key);
    // A failure keeps the old conversation, which still works.
    void request(true);
  }, [canOpen, environmentId, request, routinesThreadId, shell]);

  const router = useRouter();
  const readScreen = useStableCallback(() => {
    const screen = assistantScreenName(router.state.location);
    return screen === null ? null : screenContextRecord(screen);
  });

  return (
    <section
      aria-label="Assistant"
      data-side-chat-pane={routinesThreadId ?? "routines"}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="flex min-h-(--workspace-topbar-height) shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        {back}
        <div className="min-w-0 flex-1 basis-40">
          <h2 className={`${HEADING_CLASS} text-base`}>Assistant</h2>
          <Muted className="text-xs">{hint}</Muted>
        </div>
        {routinesThreadId !== null ? (
          <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(scopeThreadRef(environmentId, routinesThreadId))}
              className={`${ROW_ACTION_CLASS} py-1`}
            >
              Open full size
            </Link>
            <Button
              size="xs"
              variant="ghost-muted"
              disabled={!canOpen || busy}
              onClick={() => void start(true)}
            >
              Start over
            </Button>
          </div>
        ) : null}
      </header>
      {error !== null ? (
        <div className="flex flex-col items-start gap-2 p-4">
          <StatusLine tone="warning">{error}</StatusLine>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void start(false)}>
            Try again
          </Button>
        </div>
      ) : !canOpen && routinesThreadId === null ? (
        <Muted className="p-4">This connection can't start conversations.</Muted>
      ) : routinesThreadId === null || shell === null ? (
        <Muted className="p-4" role="status">
          Getting the assistant ready…
        </Muted>
      ) : (
        <BackgroundThreadContext value>
          <ComposerHandleContext value={composerRef ?? ownComposerRef}>
            <ScreenContextReader value={readScreen}>
              <ChatView
                // A fresh conversation is a new view, not the old one scrolled somewhere.
                key={routinesThreadId}
                environmentId={environmentId}
                threadId={routinesThreadId}
                routeKind="server"
                embedded={NO_PARENT_PANEL}
              />
            </ScreenContextReader>
          </ComposerHandleContext>
        </BackgroundThreadContext>
      )}
    </section>
  );
}
