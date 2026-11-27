import { ArrowLeftIcon, MessageCircleIcon } from "lucide-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  createContext,
  type ReactNode,
  type CSSProperties,
  type RefObject,
  use,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import type { ChatComposerHandle } from "../chat/ChatComposer";
import { useComposerDraftStore } from "../../composerDraftStore";
import { usePreviewPanelInlineSize } from "../../hooks/usePreviewPanelInlineSize";
import { RESIZABLE_WIDTH_PROPERTY } from "../../hooks/useResizableWidth";
import { useStableCallback } from "../../hooks/useStableCallback";
import { cn } from "../../lib/utils";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { Button } from "../ui/button";
import { RoutinesAssistant } from "./RoutinesAssistant";
import type { MajordomeVault } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useVaultRoutines } from "./useVaultRoutines";

type Ask = (text: string) => void;
const AssistantAskContext = createContext<Ask | null>(null);

/** Puts words in the assistant's text box for the person to send; null outside the dock. */
export function useAskAssistant(): Ask | null {
  return use(AssistantAskContext);
}

/**
 * A page with the assistant on its right. Where there is no room for both, the page comes first
 * and a button opens the assistant over it.
 */
export function AssistantDock({
  children,
  /** The conversation already on screen elsewhere, which must not be mounted twice. */
  shownThreadId = null,
  withoutAssistant = false,
  className,
}: {
  readonly children: ReactNode;
  /** The height of the area the dock fills. */
  readonly className: string;
  readonly shownThreadId?: string | null;
  /** A page that is itself the place to type, such as Today, goes without the assistant. */
  readonly withoutAssistant?: boolean;
}) {
  const { activeVault: vault } = useMajordomeVaults();
  const activeVault = withoutAssistant ? null : vault;
  const [open, setOpen] = useState(false);
  const askRef = useRef<Ask | null>(null);
  const [ask] = useState<Ask>(() => (text: string) => askRef.current?.(text));
  // The page keeps its place in the tree whatever the assistant does, so it never remounts.
  return (
    <AssistantAskContext value={ask}>
      <div className={cn("@container/assistant relative flex min-h-0 min-w-0 flex-1", className)}>
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 @5xl/assistant:flex",
            open && activeVault !== null ? "hidden" : "flex",
          )}
        >
          {children}
        </div>
        {activeVault === null ? null : (
          <VaultAssistant
            key={activeVault.key}
            vault={activeVault}
            shownThreadId={shownThreadId}
            open={open}
            onOpenChange={setOpen}
            askRef={askRef}
          />
        )}
      </div>
    </AssistantAskContext>
  );
}

function VaultAssistant({
  vault,
  shownThreadId,
  open,
  onOpenChange,
  askRef,
}: {
  readonly vault: MajordomeVault;
  readonly shownThreadId: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly askRef: RefObject<Ask | null>;
}) {
  const { runner } = useVaultRoutines(vault);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const ask = useStableCallback((text: string) => {
    if (runner === null) return;
    // The assistant must be on screen before its text box can take the words and the cursor.
    flushSync(() => onOpenChange(true));
    if (composerRef.current?.insertTextAtEnd(text, { ensureLeadingBoundary: true })) {
      composerRef.current.focusAtEnd();
    } else if (runner.routinesThreadId !== null) {
      // Its text box is not there yet; the words wait in the conversation's draft.
      useComposerDraftStore
        .getState()
        .setPrompt(scopeThreadRef(runner.environmentId, runner.routinesThreadId), text);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the page beside it the way into this panel's text box, and takes it back on unmount
  useEffect(() => {
    askRef.current = ask;
    return () => {
      askRef.current = null;
    };
  }, [askRef, ask]);
  const { width, handlers, observeRow } = usePreviewPanelInlineSize({
    widthStorageKey: "majordome:assistant-width",
    defaultWidth: 360,
  });
  if (
    runner === null ||
    (runner.routinesThreadId !== null && runner.routinesThreadId === shownThreadId)
  ) {
    return null;
  }
  return (
    <>
      {open ? null : (
        <div className="absolute end-4 bottom-4 z-10 @5xl/assistant:hidden">
          <Button size="sm" onClick={() => onOpenChange(true)}>
            <MessageCircleIcon />
            Assistant
          </Button>
        </div>
      )}
      <aside
        ref={observeRow}
        data-chat-surface
        style={{ [RESIZABLE_WIDTH_PROPERTY]: `${width}px` } as CSSProperties}
        className={cn(
          "relative h-full min-h-0 min-w-0 flex-1 flex-col bg-background @5xl/assistant:flex @5xl/assistant:w-(--resizable-width) @5xl/assistant:flex-none @5xl/assistant:border-l @5xl/assistant:border-border",
          open ? "flex" : "hidden",
        )}
      >
        <RightPanelResizeHandle
          handlers={handlers}
          label="Resize the assistant"
          className="hidden @5xl/assistant:block"
        />
        <RoutinesAssistant
          key={`${runner.environmentId}:${runner.projectId}`}
          copy={runner}
          composerRef={composerRef}
          back={
            <span className="@5xl/assistant:hidden">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Back to the page"
                onClick={() => onOpenChange(false)}
              >
                <ArrowLeftIcon />
              </Button>
            </span>
          }
        />
      </aside>
    </>
  );
}
