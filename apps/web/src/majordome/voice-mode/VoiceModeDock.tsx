import { useGT } from "gt-react";
import {
  ArrowUpIcon,
  EllipsisIcon,
  MessageCircleQuestionIcon,
  MicIcon,
  SquareIcon,
  Volume2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import type { ChatComposerHandle } from "~/components/chat/ChatComposer";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import "./keys";
import { armSpokenSend } from "./spokenSend";
import { useVoiceMode, useVoiceModeSnapshot } from "./useVoiceMode";
import type { VoiceModeRuntime, VoiceModeSnapshot } from "./voiceModeRuntime";

interface DockProps {
  /** The chat this composer belongs to, as `scopedThreadKey` names it. */
  readonly chatKey: string;
  readonly composerRef: { readonly current: Pick<ChatComposerHandle, "insertTextAtEnd"> | null };
  readonly promptRef: { readonly current: string };
  /** The composer's own send; a spoken message waits behind a turn that is still running. */
  readonly onSend: (event?: undefined, dispatchMode?: "queue") => Promise<unknown>;
  readonly onStop: () => unknown;
}

const ICONS: Record<VoiceModeSnapshot["state"], LucideIcon> = {
  idle: EllipsisIcon,
  starting: EllipsisIcon,
  listening: MicIcon,
  sending: EllipsisIcon,
  thinking: EllipsisIcon,
  speaking: Volume2Icon,
  "needs-you": MessageCircleQuestionIcon,
  ended: EllipsisIcon,
};

/**
 * Voice mode in a chat, in the composer's card. Mounted by the chat whether or not anyone is
 * talking: it is also how a conversation reaches the chat's own send and stop.
 */
export function VoiceModeDock(props: DockProps) {
  const runtime = useVoiceMode();
  const latest = useRef(props);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a conversation outlives renders and must reach the chat's current send, not the one captured when it started
  useEffect(() => {
    latest.current = props;
  });

  const { chatKey } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this chat's send and stop with the conversation, which lives outside React
  useEffect(() => {
    if (!runtime) return;
    return runtime.attach(chatKey, {
      send: async (text, wanted) => {
        const { composerRef, promptRef } = latest.current;
        if (promptRef.current.trim() !== "") return null;
        if (!composerRef.current?.insertTextAtEnd(text)) return null;
        // The composer takes the words in on its next render; its send reads them after that.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!wanted()) return null;
        const armed = armSpokenSend(chatKey);
        await latest.current.onSend(undefined, "queue").finally(armed.disarm);
        return armed.messageId();
      },
      setDraft: (text) => {
        const { composerRef, promptRef } = latest.current;
        if (promptRef.current.includes(text)) return;
        composerRef.current?.insertTextAtEnd(text, { ensureLeadingBoundary: true });
      },
      stopTurn: () => void latest.current.onStop(),
    });
  }, [runtime, chatKey]);

  const snapshot = useVoiceModeSnapshot(runtime);
  if (!runtime || snapshot.chatKey !== chatKey) return null;
  return <Panel runtime={runtime} snapshot={snapshot} />;
}

function Panel(props: {
  readonly runtime: VoiceModeRuntime;
  readonly snapshot: VoiceModeSnapshot;
}) {
  const gt = useGT();
  const { runtime } = props;
  const { state, line } = props.snapshot;
  const interruptible = state === "thinking" || state === "speaking";
  const needsYou = state === "needs-you";
  const root = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the keyboard goes to the conversation when it starts, off the composer it covers
  useEffect(() => {
    if (!needsYou) root.current?.focus({ preventScroll: true });
  }, [needsYou]);

  const label =
    state === "listening"
      ? gt("Listening", { $context: "voice mode state: the computer hears you" })
      : state === "speaking"
        ? gt("Speaking", { $context: "voice mode state: the assistant is talking" })
        : needsYou
          ? gt("Needs you", { $context: "voice mode state: an answer is wanted on screen" })
          : state === "sending" || state === "thinking"
            ? gt("Thinking", { $context: "voice mode state: the assistant is working" })
            : gt("Starting", { $context: "voice mode is getting ready" });
  const Icon = ICONS[state];

  return (
    <div
      ref={root}
      role="group"
      tabIndex={-1}
      aria-label={gt("Voice mode")}
      data-voice-mode={state}
      className={cn(
        "relative z-10 flex flex-col gap-2 rounded-2xl px-4 py-3 outline-none",
        needsYou && "border-border border-b rounded-b-none",
        interruptible && "cursor-pointer",
      )}
      onClick={interruptible ? () => runtime.interrupt() : undefined}
    >
      <div className="flex items-center gap-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span
          className="min-w-0 flex-1 truncate font-medium text-foreground text-sm"
          aria-live="polite"
        >
          {label}
        </span>
        {state === "listening" ? (
          <DockButton
            label={gt("Send", { $context: "verb, sends the message" })}
            keys="↵"
            variant="default"
            onPress={() => runtime.sendNow()}
          >
            <ArrowUpIcon />
          </DockButton>
        ) : interruptible ? (
          <DockButton
            label={gt("Interrupt", { $context: "verb, stops the assistant talking" })}
            keys="Space"
            variant="outline"
            onPress={() => runtime.interrupt()}
          >
            <SquareIcon className="size-3 fill-current" />
          </DockButton>
        ) : null}
        <DockButton
          label={gt("End voice mode")}
          keys={needsYou ? null : "Esc"}
          variant="ghost"
          onPress={() => runtime.close()}
        >
          <XIcon />
        </DockButton>
      </div>
      {needsYou ? null : (
        <p
          // The voice is saying this line; a screen reader repeating it would talk over it.
          aria-hidden={state === "speaking" || undefined}
          className={cn(
            "line-clamp-2 min-h-10 text-sm",
            line?.who === "you" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {line?.text ?? ""}
        </p>
      )}
    </div>
  );
}

function DockButton(props: {
  readonly label: string;
  readonly keys: string | null;
  readonly variant: "default" | "outline" | "ghost";
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant={props.variant}
            aria-label={props.label}
            onClick={(event) => {
              // The card itself interrupts; a button does only its own thing.
              event.stopPropagation();
              props.onPress();
            }}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {props.label}
        {props.keys ? ` (${props.keys})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}
