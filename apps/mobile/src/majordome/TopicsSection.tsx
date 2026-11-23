import { useAtomValue } from "@effect/atom-react";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { ProjectId } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../components/ui/AppText";
import { useSelectWorkspaceDetail } from "../features/layout/workspace/useSelectWorkspaceDetail";
import { relativeTime } from "../lib/time";
import { useThreadShells } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { majordomeEnvironment } from "./state";
import type { TopicRow } from "./today.logic";
import { todayStoreAtom } from "./todayStore";
import { useVault } from "./useVault";

/** The ids of the topics' own conversations, which the chat list below leaves out. */
export function useTopicThreadIds(): ReadonlySet<string> {
  const { topics } = useVault(useAtomValue(todayStoreAtom));
  return new Set(topics.flatMap((topic) => (topic.threadId === null ? [] : [topic.threadId])));
}

/** The topics as conversations: name, latest message, and when it last moved. */
export function MajordomeTopicsSection(props: { readonly hasOtherChats: boolean }) {
  const { vault, topics } = useVault(useAtomValue(todayStoreAtom));
  const shells = useThreadShells();
  const selectDetail = useSelectWorkspaceDetail();
  const openTopic = useAtomCommand(majordomeEnvironment.openTopic);
  const [opening, setOpening] = useState<string | null>(null);
  if (vault === null || topics.length === 0) return null;

  const open = async (topic: TopicRow) => {
    const show = (threadId: string) =>
      selectDetail({
        name: "Thread",
        params: { environmentId: String(vault.environmentId), threadId },
      });
    if (topic.threadId !== null) return show(topic.threadId);
    // A topic never opened on this server has no conversation yet; the server starts it.
    setOpening(topic.id);
    const result = await openTopic({
      environmentId: vault.environmentId,
      input: { projectId: ProjectId.make(vault.projectId), topicId: topic.id },
    });
    setOpening(null);
    if (result._tag === "Success") show(String(result.value.threadId));
  };

  return (
    <View className="pb-2">
      {topics.map((topic) => {
        const shell = shells.find(
          (candidate) =>
            candidate.environmentId === vault.environmentId &&
            String(candidate.id) === topic.threadId,
        );
        return (
          <Pressable
            key={topic.id}
            accessibilityRole="button"
            accessibilityLabel={topic.title}
            disabled={opening !== null}
            className="flex-row items-center gap-3 px-5 py-2.5 active:bg-subtle"
            onPress={() => void open(topic)}
          >
            <View className="size-11 items-center justify-center rounded-full bg-subtle">
              <Text textRole="headline" className="font-t3-medium text-foreground">
                {topic.title.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View className="min-w-0 flex-1">
              <View className="flex-row items-baseline justify-between gap-2">
                <Text numberOfLines={1} className="shrink font-t3-medium text-foreground">
                  {topic.title}
                </Text>
                {shell ? (
                  <Text textRole="label" className="text-foreground-muted">
                    {relativeTime(resolveThreadActivityTimestamp(shell) ?? shell.createdAt)}
                  </Text>
                ) : null}
              </View>
              <Text numberOfLines={1} textRole="footnote" className="text-foreground-muted">
                {opening === topic.id ? "Opening…" : (topic.preview ?? "Nothing said yet")}
              </Text>
            </View>
          </Pressable>
        );
      })}
      {props.hasOtherChats ? (
        <Text textRole="footnote" className="px-5 pt-4 font-t3-medium text-foreground-muted">
          Other chats
        </Text>
      ) : null}
    </View>
  );
}
