import {
  FULL_ACCESS_OVERRIDE_QUESTION,
  fullAccessOverrideExplanation,
} from "@t3tools/client-runtime/state/thread-requests";
import { useMessages } from "gt-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import type { PendingApprovalCardProps } from "../features/threads/PendingApprovalCard";
import { approvalChoices, approvalQuestion } from "./conversation.logic";

/** An approval as a question anyone can answer, with what exactly was asked kept underneath. */
export function MajordomeApprovalCard(props: PendingApprovalCardProps) {
  const m = useMessages();
  const { approval } = props;
  const choices = approvalChoices(approval.options, "decline");
  const warning = choices.find((choice) => choice.warning)?.warning;
  const canRespond = approval.responseCapability === "live";
  const disabled =
    !canRespond || !props.canOperateThread || props.respondingApprovalId === approval.requestId;
  const [explanationOpen, setExplanationOpen] = useState(false);
  const question = approvalQuestion({
    kind: approval.requestKind,
    detail: approval.detail,
    appName: approval.appName,
  });
  return (
    <View className="gap-2.5 rounded-[20px] border border-border bg-card-alt p-4">
      <Text accessibilityRole="header" className="font-t3-bold text-lg text-foreground">
        {question}
      </Text>
      {approval.detail ? (
        <Text
          selectable
          className="rounded-xl bg-subtle px-3 py-2 font-sans text-xs leading-normal text-foreground-secondary"
        >
          {approval.detail}
        </Text>
      ) : null}
      {approval.reason ? (
        <Text className="font-sans text-xs leading-normal text-warning-foreground">
          {approval.reason}
        </Text>
      ) : null}
      {approval.fullAccessOverride ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: explanationOpen }}
          className="min-h-11 justify-center"
          onPress={() => setExplanationOpen((open) => !open)}
        >
          <Text className="font-t3-bold text-xs text-foreground-secondary underline">
            {m(FULL_ACCESS_OVERRIDE_QUESTION)}
          </Text>
          {explanationOpen ? (
            <Text className="mt-1 font-sans text-xs leading-normal text-foreground-muted">
              {fullAccessOverrideExplanation(approval.fullAccessOverride, m)}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
      {warning ? (
        <Text className="font-sans text-xs leading-normal text-warning-foreground">{warning}</Text>
      ) : null}
      <View className="gap-2">
        {choices.map((choice) => (
          <Button
            key={choice.decision}
            label={choice.label}
            tone={
              choice.decision === "accept"
                ? "primary"
                : choice.decision === "decline"
                  ? "danger"
                  : "secondary"
            }
            disabled={disabled}
            onPress={() => void props.onRespond(approval.requestId, choice.decision)}
            fullWidth
          />
        ))}
      </View>
      {!canRespond ? (
        <Text className="font-sans text-sm leading-5 text-foreground-muted">
          This question can no longer be answered. Stop Majordome, then ask again.
        </Text>
      ) : !props.canOperateThread ? (
        <Text className="font-sans text-xs text-foreground-muted">
          This phone isn't allowed to answer for that computer.
        </Text>
      ) : null}
    </View>
  );
}
