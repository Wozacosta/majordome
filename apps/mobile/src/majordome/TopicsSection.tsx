import { useAtomValue } from "@effect/atom-react";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { type MajordomeTopicIcon, ProjectId } from "@t3tools/contracts";
import type { TopicTone } from "@t3tools/shared/majordomeTopicIcons";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { SFSymbol } from "expo-symbols";
import { useState } from "react";
import { View } from "react-native";

import { Menu } from "../components/ui/Menu";
import { RowPressable } from "../components/ui/RowPressable";
import { useSelectWorkspaceDetail } from "../features/layout/workspace/useSelectWorkspaceDetail";
import { THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME } from "../features/threads/thread-list-v2-row-appearance";
import {
  resolveThreadListV2RowStatus,
  threadHasUnseenCompletion,
} from "../features/threads/threadListV2";
import { useNowMinuteMs } from "../lib/clock";
import { relativeTime } from "../lib/time";
import { useThreadShells } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { chatRowLabel, chatStatusLine, topicLine } from "./chat.logic";
import { ChatListLabel, ChatRowContent } from "./ChatRow";
import { majordomeEnvironment } from "./state";
import type { TopicRow } from "./today.logic";
import { todayStoreAtom } from "./todayStore";
import { useVault } from "./useVault";

/** The desktop's topic icons as the iPhone's own symbols. */
const TOPIC_SYMBOLS: Record<MajordomeTopicIcon, SFSymbol> = {
  hash: "number",
  dumbbell: "dumbbell.fill",
  footprints: "figure.walk",
  wallet: "creditcard.fill",
  receipt: "doc.text.fill",
  bitcoin: "bitcoinsign.circle.fill",
  plane: "airplane",
  "heart-pulse": "heart.fill",
  "book-open": "book.fill",
  languages: "character.bubble.fill",
  briefcase: "briefcase.fill",
  home: "house.fill",
  utensils: "fork.knife",
  music: "music.note",
  code: "chevron.left.forwardslash.chevron.right",
  "pen-line": "pencil.line",
  users: "person.2.fill",
  leaf: "leaf.fill",
  car: "car.fill",
  lightbulb: "lightbulb.fill",
};

const TONE_COLORS: Record<TopicTone, string> = {
  amber: "#f59e0b",
  orange: "#f97316",
  rose: "#f43f5e",
  pink: "#ec4899",
  fuchsia: "#d946ef",
  violet: "#8b5cf6",
  indigo: "#6366f1",
  sky: "#0ea5e9",
  cyan: "#06b6d4",
  teal: "#14b8a6",
  emerald: "#10b981",
  lime: "#84cc16",
};

/** The ids of the topics' own conversations, which the chat list below leaves out. */
export function useTopicThreadIds(): ReadonlySet<string> {
  const { topics } = useVault(useAtomValue(todayStoreAtom));
  return new Set(topics.flatMap((topic) => (topic.threadId === null ? [] : [topic.threadId])));
}

/** True when there are topics to list, so the Chats tab is not empty even with no other chat. */
export function useHasTopics(): boolean {
  return useVault(useAtomValue(todayStoreAtom)).topics.length > 0;
}

function TopicRowView(props: {
  readonly topic: TopicRow;
  readonly shell: EnvironmentThreadShell | undefined;
  readonly nowMs: number;
  readonly opening: boolean;
  readonly disabled: boolean;
  readonly onOpen: (sideChat: boolean) => void;
}) {
  const { topic, shell } = props;
  const markUnread = useAtomCommand(threadEnvironment.markUnread, { reportFailure: false });
  const status = shell ? resolveThreadListV2RowStatus(shell) : "ready";
  const unread = shell !== undefined && status === "ready" && threadHasUnseenCompletion(shell);
  const line = props.opening
    ? ({ words: "Opening…", tone: "plain" } as const)
    : topicLine(topic, chatStatusLine(status, unread));
  const time = shell
    ? relativeTime(resolveThreadActivityTimestamp(shell) ?? shell.createdAt, props.nowMs)
    : null;
  const label = chatRowLabel({ title: topic.title, line, time });
  return (
    <Menu
      accessibilityLabel={label}
      actions={[
        {
          id: "side-chat",
          title: `New chat about ${topic.title}`,
          image: "square.and.pencil",
        },
        ...(shell && !unread
          ? [{ id: "mark-unread", title: "Mark unread", image: "envelope.badge" }]
          : []),
      ]}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "side-chat") props.onOpen(true);
        if (nativeEvent.event === "mark-unread" && shell) {
          void markUnread({ environmentId: shell.environmentId, input: { threadId: shell.id } });
        }
      }}
      shouldOpenOnLongPress
    >
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the topic's conversation. Touch and hold for more."
        accessibilityState={{ busy: props.opening, disabled: props.disabled }}
        className="bg-screen"
        disabled={props.disabled}
        onPress={() => props.onOpen(false)}
      >
        <View className={THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME}>
          <ChatRowContent
            title={topic.title}
            symbol={TOPIC_SYMBOLS[topic.icon ?? "hash"]}
            color={TONE_COLORS[topic.tone ?? "amber"]}
            line={line}
            time={time}
          />
        </View>
      </RowPressable>
    </Menu>
  );
}

/** The topics as conversations: name, what is going on in each, and when it last moved. */
export function MajordomeTopicsSection(props: { readonly hasOtherChats: boolean }) {
  const { vault, topics } = useVault(useAtomValue(todayStoreAtom));
  const shells = useThreadShells();
  const nowMs = useNowMinuteMs();
  const selectDetail = useSelectWorkspaceDetail();
  const openTopic = useAtomCommand(majordomeEnvironment.openTopic);
  const [opening, setOpening] = useState<string | null>(null);
  if (vault === null || topics.length === 0) return null;

  const open = async (topic: TopicRow, sideChat: boolean) => {
    const show = (threadId: string) =>
      selectDetail({
        name: "Thread",
        params: { environmentId: String(vault.environmentId), threadId },
      });
    if (!sideChat && topic.threadId !== null) return show(topic.threadId);
    // A topic never opened on this server has no conversation yet; the server starts it.
    setOpening(topic.id);
    const result = await openTopic({
      environmentId: vault.environmentId,
      input: {
        projectId: ProjectId.make(vault.projectId),
        topicId: topic.id,
        ...(sideChat ? { sideChat: true } : {}),
      },
    });
    setOpening(null);
    if (result._tag === "Success") show(String(result.value.threadId));
  };

  return (
    <View>
      {topics.map((topic) => (
        <TopicRowView
          key={topic.id}
          topic={topic}
          shell={shells.find(
            (candidate) =>
              candidate.environmentId === vault.environmentId &&
              String(candidate.id) === topic.threadId,
          )}
          nowMs={nowMs}
          opening={opening === topic.id}
          disabled={opening !== null}
          onOpen={(sideChat) => void open(topic, sideChat)}
        />
      ))}
      {props.hasOtherChats ? <ChatListLabel>Other chats</ChatListLabel> : null}
    </View>
  );
}
