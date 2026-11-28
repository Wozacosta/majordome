import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { AuthOrchestrationOperateScope, type ProviderApprovalDecision } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useMessages } from "gt-react-native";
import { memo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { relativeTime } from "../lib/time";
import { useEnvironmentScope } from "../state/session";
import { environmentThreadDetails, threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { chatRowLabel, chatTitle } from "./chat.logic";
import { TopicSymbolView } from "./ChatRow";
import { approvalQuestion } from "./conversation.logic";
import { answersFromHome } from "./home.logic";
import type { TopicRow } from "./today.logic";
import { TONE_COLORS, TOPIC_SYMBOLS } from "./topicFaces";

const NO_REQUESTS = Atom.make<PendingThreadRequests | null>(null);

/**
 * The requests of the first chat that needs the owner: the only chat home reads them for, and
 * only while it says it waits for an OK or an answer.
 */
export function useNeedsCardRequests(thread: EnvironmentThreadShell | null) {
  return useAtomValue(
    thread !== null && (thread.hasPendingApprovals || thread.hasPendingUserInput)
      ? environmentThreadDetails.pendingRequestsAtom({
          environmentId: thread.environmentId,
          threadId: thread.id,
        })
      : NO_REQUESTS,
  );
}

/** What those requests ask, for the card: an approval before a question. */
export function needsCardRequest(requests: PendingThreadRequests | null): {
  readonly request: string | null;
  readonly detail: string | null;
} {
  const approval = requests?.approvals[0];
  if (approval !== undefined) {
    return {
      request: approvalQuestion({
        kind: approval.requestKind,
        detail: approval.detail,
        appName: approval.appName,
      }),
      detail: approval.detail ?? null,
    };
  }
  return { request: requests?.userInputs[0]?.questions[0]?.question ?? null, detail: null };
}

/**
 * The first chat that needs the owner, drawn as a card that says what is asked. An approval
 * that is one short request is answered here, the way the chat's own card answers it; anything
 * else opens the chat.
 */
export const HomeNeedsCard = memo(function HomeNeedsCard(props: {
  readonly thread: EnvironmentThreadShell;
  readonly topic: TopicRow | undefined;
  readonly routine: boolean;
  /** What is asked, or the reply itself. */
  readonly words: string;
  readonly detail: string | null;
  readonly requests: PendingThreadRequests | null;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
}) {
  const m = useMessages();
  const { thread, topic, requests, words } = props;
  const mayAnswer = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const respond = useAtomCommand(threadEnvironment.respondToApproval, { reportFailure: false });
  const [sent, setSent] = useState<ProviderApprovalDecision | null>(null);
  const [failed, setFailed] = useState(false);
  const only =
    requests?.approvals.length === 1 && requests.userInputs.length === 0
      ? (requests.approvals[0] ?? null)
      : null;
  const approval = only !== null && mayAnswer && answersFromHome(only) ? only : null;
  const title = topic ? topic.title : chatTitle(thread.title);
  const time = relativeTime(
    resolveThreadActivityTimestamp(thread) ?? thread.createdAt,
    undefined,
    m,
  );
  const answer = async (decision: ProviderApprovalDecision) => {
    if (approval === null || sent !== null) return;
    setSent(decision);
    setFailed(false);
    const result = await respond({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, requestId: approval.requestId, decision },
    });
    setSent(null);
    if (result._tag !== "Success") setFailed(true);
  };

  return (
    <View className="mx-3.5 mb-1.5 rounded-[18px] border border-primary/35 bg-card-alt">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={chatRowLabel({
          title,
          topic: topic !== undefined,
          line: { words, tone: "asking" },
          time,
        })}
        accessibilityHint="Opens the chat"
        onPress={() => props.onOpen(thread)}
        className="gap-2 px-3.5 py-3 active:opacity-70"
      >
        <View className="flex-row items-center gap-2">
          <TopicSymbolView
            name={
              topic
                ? TOPIC_SYMBOLS[topic.icon ?? "hash"]
                : props.routine
                  ? "arrow.triangle.2.circlepath"
                  : "bubble.left.fill"
            }
            size={16}
            tintColor={topic ? TONE_COLORS[topic.tone ?? "amber"] : undefined}
            tintColorClassName={topic ? undefined : "accent-icon-muted"}
          />
          <Text numberOfLines={1} className="min-w-0 flex-1 font-t3-bold text-base text-foreground">
            {title}
          </Text>
          <Text className="text-xs tabular-nums text-foreground-tertiary">{time}</Text>
        </View>
        <Text numberOfLines={2} className="text-base text-foreground">
          {words}
        </Text>
        {props.detail === null ? null : (
          <Text numberOfLines={1} className="text-xs text-foreground-secondary">
            {props.detail}
          </Text>
        )}
      </Pressable>
      {approval === null ? null : (
        <View className="gap-2 px-3.5 pb-3">
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                label="OK"
                accessibilityLabel={`OK, ${title}`}
                tone="primary"
                fullWidth
                disabled={sent !== null}
                loading={sent === "accept"}
                onPress={() => void answer("accept")}
              />
            </View>
            <View className="flex-1">
              <Button
                label="Not now"
                accessibilityLabel={`Not now, ${title}`}
                fullWidth
                disabled={sent !== null}
                loading={sent === "decline"}
                onPress={() => void answer("decline")}
              />
            </View>
          </View>
          {failed ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              textRole="footnote"
              className="text-danger-foreground"
            >
              That couldn't be sent. Open the chat to answer.
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
});
