import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { pickTodayStarter, TODAY_STARTERS } from "@t3tools/shared/majordomeToday";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../components/ui/AppText";
import { Chip } from "../components/ui/Chip";
import { IconButton } from "../components/ui/IconButton";
import { useSelectWorkspaceDetail } from "../features/layout/workspace/useSelectWorkspaceDetail";
import {
  createNewTaskDraft,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../state/use-composer-drafts";
import { noteSendOnOpen } from "./sendOnOpen";

/**
 * Today's one box: what is typed goes to the assistant as a new chat, sent as it opens. With no
 * connection the words are kept as a line of the journal instead, so nothing typed is lost.
 */
export function TodayAsk(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly connected: boolean;
  /** Keeps the words as a journal line, for when the assistant cannot be reached. */
  readonly onKeep: (text: string) => void;
}) {
  const { environmentId, projectId } = props;
  const selectDetail = useSelectWorkspaceDetail();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const send = async (given?: string) => {
    const prompt = (given ?? text).trim();
    if (prompt === "") return;
    void Haptics.selectionAsync();
    if (!props.connected) {
      props.onKeep(prompt);
      setText("");
      setNotice("Kept in your journal. Your assistant will see it once it can be reached.");
      return;
    }
    try {
      await waitForComposerDraftsLoaded();
    } catch {
      setNotice("That couldn't be sent. Try again.");
      return;
    }
    const draftId = createNewTaskDraft({ environmentId, projectId });
    setComposerDraftText(draftId, prompt);
    noteSendOnOpen();
    setText("");
    setNotice(null);
    selectDetail({
      name: "Thread",
      params: { draft: { environmentId, projectId, draftId } },
    });
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-end gap-2">
        <View className="min-w-0 flex-1">
          <TextInput
            accessibilityLabel="Ask anything, or tell me what to remember"
            placeholder="Ask anything, or tell me what to remember…"
            multiline
            value={text}
            onChangeText={(next) => {
              setText(next);
              setNotice(null);
            }}
          />
        </View>
        <IconButton
          icon="arrow.up"
          variant="primary"
          accessibilityLabel="Send"
          disabled={text.trim() === ""}
          onPress={() => void send()}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // The row runs to the screen's edges, past the page's own margins.
        className="-mx-5"
        contentContainerClassName="gap-2 px-5"
      >
        {TODAY_STARTERS.map((starter) => (
          <Chip
            key={starter.label}
            label={starter.label}
            onPress={() => {
              const picked = pickTodayStarter(text, starter);
              if (picked.send) void send(picked.text);
              else setText(picked.text);
            }}
          />
        ))}
      </ScrollView>
      {notice === null ? null : (
        <Text
          accessibilityLiveRegion="polite"
          textRole="footnote"
          className="text-foreground-secondary"
        >
          {notice}
        </Text>
      )}
    </View>
  );
}
