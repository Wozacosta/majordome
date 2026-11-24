import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { ProjectId } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import * as Dialog from "../components/ui/Dialog";
import { Menu } from "../components/ui/Menu";
import { RowPressable } from "../components/ui/RowPressable";
import { useSelectWorkspaceDetail } from "../features/layout/workspace/useSelectWorkspaceDetail";
import { THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME } from "../features/threads/thread-list-v2-row-appearance";
import { cn } from "../lib/cn";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { chatRowLabel, topicLine, topicMenuActions } from "./chat.logic";
import { ChatListLabel, ChatRowContent } from "./ChatRow";
import { majordomeEnvironment } from "./state";
import type { TopicRow } from "./today.logic";
import { routineChats } from "./routine.logic";
import { todayStoreAtom, updateTodayStore } from "./todayStore";
import { placeTopics, type FinishedTopic } from "./topic.logic";
import { TONE_COLORS, TOPIC_SYMBOLS, type ChatTopics } from "./topicFaces";
import { useVault } from "./useVault";

/** The conversations of topics marked as done, which the chat list leaves out. */
export function useDoneTopicThreadIds(): ReadonlySet<string> {
  const { finished } = useVault(useAtomValue(todayStoreAtom));
  return new Set(finished.flatMap((topic) => (topic.threadId === null ? [] : [topic.threadId])));
}

const NO_ROUTINES: ReadonlyArray<string> = [];

/**
 * The topics for the Chats list: which ride on a chat's row, which are listed apart, which are
 * done, and how to open one or change it.
 */
export function useChatListTopics(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  searchQuery: string,
): ChatTopics {
  const store = useAtomValue(todayStoreAtom);
  const { vault, topics, finished } = useVault(store);
  const tasks = useEnvironmentQuery(
    vault === null
      ? null
      : serverEnvironment.scheduledTasksLive({ environmentId: vault.environmentId, input: {} }),
  );
  const routineOf = routineChats(
    tasks.data?.tasks ?? [],
    threads.flatMap((thread) =>
      thread.environmentId === vault?.environmentId
        ? [{ id: String(thread.id), title: thread.title, createdBy: thread.source.createdBy }]
        : [],
    ),
  );
  // The rows only redraw when which chats are a routine's changes.
  const routineKey = JSON.stringify([...routineOf]);
  const routineOfStable = useMemo(
    () => new Map(JSON.parse(routineKey) as ReadonlyArray<readonly [string, string]>),
    [routineKey],
  );
  const hiddenRoutines = store?.hiddenRoutines ?? NO_ROUTINES;
  const selectDetail = useSelectWorkspaceDetail();
  const openTopic = useAtomCommand(majordomeEnvironment.openTopic);
  const updateTopic = useAtomCommand(majordomeEnvironment.updateTopic, { reportFailure: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const toggleSideChats = (topicId: string) =>
    setUnfolded((current) => {
      const next = new Set(current);
      if (!next.delete(topicId)) next.add(topicId);
      return next;
    });
  const environmentId = vault?.environmentId;
  const listedThreadIds = new Set(
    threads.flatMap((thread) =>
      thread.environmentId === environmentId && thread.archivedAt === null
        ? [String(thread.id)]
        : [],
    ),
  );
  const placed = placeTopics(topics, listedThreadIds, searchQuery);
  const orderKey = topics.map((topic) => topic.id).join("\n");
  // Chats change far more often than where the topics go; the rows only redraw when that does.
  const placedKey = JSON.stringify({ byThread: [...placed.byThread], apart: placed.apart });
  const { byThread, apart } = useMemo(() => {
    const parsed = JSON.parse(placedKey) as {
      readonly byThread: ReadonlyArray<readonly [string, TopicRow]>;
      readonly apart: ReadonlyArray<TopicRow>;
    };
    return { byThread: new Map(parsed.byThread), apart: parsed.apart };
  }, [placedKey]);

  const show = (threadId: string) => {
    if (vault === null) return;
    selectDetail({
      name: "Thread",
      params: { environmentId: String(vault.environmentId), threadId },
    });
  };
  // A topic never opened on this server has no conversation yet; the server starts it.
  const start = async (topicId: string, sideChat: boolean) => {
    if (vault === null || busy !== null) return;
    setBusy(topicId);
    const result = await openTopic({
      environmentId: vault.environmentId,
      input: {
        projectId: ProjectId.make(vault.projectId),
        topicId,
        ...(sideChat ? { sideChat: true } : {}),
      },
    });
    setBusy(null);
    if (result._tag === "Success") show(String(result.value.threadId));
  };
  const setFinished: ChatTopics["setFinished"] = async (topic, done) => {
    if (vault === null || busy !== null) return;
    setBusy(topic.id);
    const result = await updateTopic({
      environmentId: vault.environmentId,
      input: { projectId: ProjectId.make(vault.projectId), topicId: topic.id, finished: done },
    });
    setBusy(null);
    if (result._tag !== "Success") {
      Dialog.alert(
        done ? `Could not mark ${topic.title} as done` : `Could not bring ${topic.title} back`,
        "Check that your computer can be reached, then try again.",
      );
      return;
    }
    if (!done) return;
    Dialog.alert(
      `${topic.title} is marked as done`,
      "Its notes and its conversation are kept. Bring it back from Done topics, at the bottom of this list.",
      [{ text: "Undo", onPress: () => void setFinished(topic, false) }, { text: "OK" }],
    );
  };

  return {
    byThread,
    apart,
    order: orderKey === "" ? NO_ROUTINES : orderKey.split("\n"),
    finished,
    total: topics.length + finished.length,
    busy,
    unfolded,
    toggleSideChats,
    routineOf: routineOfStable,
    hiddenRoutines,
    setRoutineHidden: (title, hidden) =>
      updateTodayStore((current) => {
        const others = (current.hiddenRoutines ?? []).filter((name) => name !== title);
        return { ...current, hiddenRoutines: hidden ? [...others, title] : others };
      }),
    open: (topic) => (topic.threadId === null ? void start(topic.id, false) : show(topic.threadId)),
    startSideChat: (topic) => void start(topic.id, true),
    setFinished: (topic, done) => void setFinished(topic, done),
  };
}

/** A topic with no row among the chats yet: nothing was said in it on this computer. */
function TopicRowView(props: { readonly topic: TopicRow; readonly topics: ChatTopics }) {
  const { topic, topics } = props;
  const opening = topics.busy === topic.id;
  const line = opening ? ({ words: "Opening…", tone: "plain" } as const) : topicLine(topic, null);
  const label = chatRowLabel({ title: topic.title, topic: true, line, time: null });
  return (
    <Menu
      accessibilityLabel={label}
      actions={topicMenuActions([], topic.title)}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "topic-side-chat") topics.startSideChat(topic);
        if (nativeEvent.event === "topic-finish") topics.setFinished(topic, true);
      }}
      shouldOpenOnLongPress
    >
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the topic's conversation. Touch and hold for more."
        accessibilityState={{ busy: opening, disabled: topics.busy !== null }}
        className="bg-screen"
        disabled={topics.busy !== null}
        onPress={() => topics.open(topic)}
      >
        <View className={THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME}>
          <ChatRowContent
            title={topic.title}
            symbol={TOPIC_SYMBOLS[topic.icon ?? "hash"]}
            color={TONE_COLORS[topic.tone ?? "amber"]}
            line={line}
            time={null}
          />
        </View>
      </RowPressable>
    </Menu>
  );
}

/** Topics with no conversation yet, drawn among the pinned ones at their place in the order. */
export function MajordomeTopicRows(props: {
  readonly rows: ReadonlyArray<TopicRow>;
  readonly topics: ChatTopics;
}) {
  return props.rows.map((topic) => (
    <TopicRowView key={topic.id} topic={topic} topics={props.topics} />
  ));
}

/** Above the chats: the topics that have no row among them yet. */
export function MajordomeTopicsSection(props: {
  readonly topics: ChatTopics;
  readonly hasChatsBelow: boolean;
  readonly searching: boolean;
  /** The list draws these topics itself, among the ones that have a conversation. */
  readonly drawnInList: boolean;
}) {
  const { topics } = props;
  if (topics.apart.length === 0 || props.drawnInList) return null;
  return (
    <View>
      {topics.apart.map((topic) => (
        <TopicRowView key={topic.id} topic={topic} topics={topics} />
      ))}
      {props.hasChatsBelow && !props.searching ? <ChatListLabel>Recent</ChatListLabel> : null}
    </View>
  );
}

function DoneTopicRow(props: { readonly topic: FinishedTopic; readonly topics: ChatTopics }) {
  const { topic, topics } = props;
  return (
    <View className={cn(THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME, "flex-row items-center gap-3")}>
      <Text
        accessibilityLabel={`${topic.title}, topic, done`}
        className="flex-1 text-base text-foreground-muted"
        numberOfLines={2}
      >
        {topic.title}
      </Text>
      <Button
        label="Bring back"
        accessibilityLabel={`Bring ${topic.title} back`}
        loading={topics.busy === topic.id}
        disabled={topics.busy !== null}
        onPress={() => topics.setFinished(topic, false)}
      />
    </View>
  );
}

/** Under the chats: the topics marked as done, folded away until asked for, each with a way back. */
export function MajordomeDoneTopics(props: { readonly topics: ChatTopics }) {
  const { topics } = props;
  const [expanded, setExpanded] = useState(false);
  if (topics.finished.length === 0) return null;
  const count = topics.finished.length;
  return (
    <View>
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={`Done topics, ${count}`}
        accessibilityState={{ expanded }}
        className="bg-screen"
        onPress={() => setExpanded((value) => !value)}
      >
        <View className="min-h-[44px] flex-row items-center gap-2.5 px-5">
          <Text className="text-xs font-t3-medium text-foreground-tertiary">
            {`Done topics · ${count}`}
          </Text>
          <View className="h-px flex-1 bg-border" />
          <Text className="text-xs font-t3-medium text-foreground-tertiary">
            {expanded ? "Hide" : "Show"}
          </Text>
        </View>
      </RowPressable>
      {expanded
        ? topics.finished.map((topic) => (
            <DoneTopicRow key={topic.id} topic={topic} topics={topics} />
          ))
        : null}
    </View>
  );
}

/** The routines taken out of the Chats list, folded at its bottom with the way back. */
export function MajordomeHiddenRoutines(props: { readonly topics: ChatTopics }) {
  const { topics } = props;
  const [expanded, setExpanded] = useState(false);
  const count = topics.hiddenRoutines.length;
  if (count === 0) return null;
  return (
    <View>
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={`Hidden routines, ${count}`}
        accessibilityState={{ expanded }}
        className="bg-screen"
        onPress={() => setExpanded((value) => !value)}
      >
        <View className="min-h-[44px] flex-row items-center gap-2.5 px-5">
          <Text className="text-xs font-t3-medium text-foreground-tertiary">
            {`Hidden routines · ${count}`}
          </Text>
          <View className="h-px flex-1 bg-border" />
          <Text className="text-xs font-t3-medium text-foreground-tertiary">
            {expanded ? "Hide" : "Show"}
          </Text>
        </View>
      </RowPressable>
      {expanded
        ? topics.hiddenRoutines.map((title) => (
            <View key={title} className="min-h-[44px] flex-row items-center gap-3 px-5 py-1.5">
              <Text numberOfLines={1} className="flex-1 text-base text-foreground-muted">
                {title}
              </Text>
              <Button
                label="Show in Chats"
                accessibilityLabel={`Show ${title} in Chats`}
                onPress={() => topics.setRoutineHidden(title, false)}
              />
            </View>
          ))
        : null}
    </View>
  );
}
