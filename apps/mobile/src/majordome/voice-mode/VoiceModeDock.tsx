import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { msg, useLocale, useMessages } from "gt-react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";

import { ComposerActionButton } from "../../components/ComposerToolbar";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { voiceModeAvailableAtom } from "./availability";
import { takeTalkIntent } from "./newChatIntent";
import { attachVoiceModeChat, openVoiceMode, voiceMode, voiceModeChatKey } from "./platform";
import type { VoiceModeSnapshot } from "./voiceModeRuntime";

const noSubscription = () => () => {};
const IDLE: VoiceModeSnapshot = { chatKey: null, state: "idle", line: null };

const STATE: Record<
  VoiceModeSnapshot["state"],
  { readonly label: string; readonly icon: AppSymbolName }
> = {
  idle: { label: msg("Starting", { $context: "voice mode is getting ready" }), icon: "ellipsis" },
  starting: {
    label: msg("Starting", { $context: "voice mode is getting ready" }),
    icon: "ellipsis",
  },
  listening: {
    label: msg("Listening", { $context: "voice mode state: the phone hears you" }),
    icon: "mic",
  },
  sending: {
    label: msg("Thinking", { $context: "voice mode state: the assistant is working" }),
    icon: "ellipsis",
  },
  thinking: {
    label: msg("Thinking", { $context: "voice mode state: the assistant is working" }),
    icon: "ellipsis",
  },
  speaking: {
    label: msg("Speaking", { $context: "voice mode state: the assistant is talking" }),
    icon: "speaker.wave.2",
  },
  "needs-you": {
    label: msg("Needs you", { $context: "voice mode state: an answer is wanted on screen" }),
    icon: "questionmark.bubble",
  },
  ended: { label: msg("Starting", { $context: "voice mode is getting ready" }), icon: "ellipsis" },
};

function useVoiceModeSnapshot(): VoiceModeSnapshot {
  return useSyncExternalStore(
    voiceMode?.subscribe ?? noSubscription,
    () => voiceMode?.getSnapshot() ?? IDLE,
  );
}

/** True while this chat is being talked in: its composer makes room for the dock. */
export function useVoiceModeActive(environmentId: EnvironmentId, threadId: ThreadId): boolean {
  return useVoiceModeSnapshot().chatKey === voiceModeChatKey({ environmentId, threadId });
}

/**
 * Voice mode in a chat, docked where the composer sits so the approval and question cards
 * above it stay within reach. Mounted by the chat whether or not anyone is talking: it is
 * also how a conversation reaches the chat's own send and stop.
 */
export function VoiceModeDock(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly isDraft: boolean;
  readonly bottomInset: number;
  readonly onChangeDraft: (text: string) => void;
  readonly onSend: () => Promise<string | null>;
  readonly onStop: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const available = useAtomValue(voiceModeAvailableAtom);
  const snapshot = useVoiceModeSnapshot();
  const { environmentId, threadId } = props;
  const latest = useRef(props);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a conversation outlives renders and must reach the chat's current send, not the one captured when it started
  useEffect(() => {
    latest.current = props;
  });

  // Registers this chat's send and stop with the conversation, which lives outside React. Tied
  // to focus, not to mounting: a screen opened over the chat leaves it mounted, and that is
  // leaving the chat too.
  useFocusEffect(
    useCallback(
      () =>
        attachVoiceModeChat(
          { environmentId, threadId },
          {
            setDraft: (text) => latest.current.onChangeDraft(text),
            send: () => latest.current.onSend(),
            stopTurn: () => latest.current.onStop(),
          },
        ),
      [environmentId, threadId],
    ),
  );

  const startsTalking = props.isDraft && available;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the "Talk" shortcut opened this new chat from outside React; it starts talking once the chat is on screen
  useEffect(() => {
    if (startsTalking && takeTalkIntent()) openVoiceMode({ environmentId, threadId }, locale);
  }, [startsTalking, environmentId, threadId, locale]);

  if (!voiceMode || snapshot.chatKey !== voiceModeChatKey({ environmentId, threadId })) return null;
  const runtime = voiceMode;
  const { state, line } = snapshot;
  const interruptible = state === "thinking" || state === "speaking";
  const presentation = STATE[state];
  return (
    <View className="px-3 pt-1" style={{ paddingBottom: Math.max(props.bottomInset, 12) }}>
      <View className="gap-3 rounded-3xl border border-border bg-card p-4">
        {/* The whole dock interrupts; the buttons sit above this layer so they keep their own taps. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            interruptible
              ? m(msg("{state}. Double tap to interrupt.", { state: m(presentation.label) }))
              : m(presentation.label)
          }
          disabled={!interruptible}
          onPress={() => runtime.interrupt()}
          className="absolute inset-0 rounded-3xl active:bg-subtle"
        />
        <View pointerEvents="box-none" className="flex-row items-center gap-3">
          <View pointerEvents="none" className="min-w-0 flex-1 flex-row items-center gap-3">
            <SymbolView
              name={presentation.icon}
              size={20}
              tintColorClassName="accent-foreground"
              type="monochrome"
            />
            <Text className="min-w-0 flex-1 text-base font-t3-medium text-foreground">
              {m(presentation.label)}
            </Text>
          </View>
          {state === "listening" ? (
            <ComposerActionButton
              accessibilityLabel={m(msg("Send", { $context: "verb, sends the message" }))}
              icon="arrow.up"
              variant="primary"
              onPress={() => runtime.sendNow()}
            />
          ) : null}
          <IconButton
            icon="xmark"
            accessibilityLabel={m(msg("End voice mode"))}
            onPress={() => runtime.close()}
          />
        </View>
        <Text
          pointerEvents="none"
          // The voice is saying this line; a screen reader repeating it would talk over it.
          accessibilityElementsHidden={state === "speaking"}
          importantForAccessibility={state === "speaking" ? "no-hide-descendants" : "auto"}
          className={
            line?.who === "you"
              ? "min-h-[66px] text-base text-foreground-muted"
              : "min-h-[66px] text-base text-foreground"
          }
          numberOfLines={3}
        >
          {line?.text ?? ""}
        </Text>
      </View>
    </View>
  );
}

/** Where Send sits while the composer is empty: starts talking in this chat. */
export function VoiceModeButton(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly size?: "regular" | "large";
  readonly disabled: boolean;
}) {
  const m = useMessages();
  const locale = useLocale();
  return (
    <ComposerActionButton
      accessibilityLabel={m(msg("Talk", { $context: "verb, start talking with the assistant" }))}
      size={props.size}
      icon="waveform"
      variant="primary"
      disabled={props.disabled}
      onPress={() =>
        openVoiceMode({ environmentId: props.environmentId, threadId: props.threadId }, locale)
      }
    />
  );
}

/** Whether this phone can talk with the assistant at all. */
export function useVoiceModeAvailable(): boolean {
  return useAtomValue(voiceModeAvailableAtom);
}
