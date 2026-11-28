import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../components/ui/AppText";
import { IconButton } from "../components/ui/IconButton";
import { useSelectWorkspaceDetail } from "../features/layout/workspace/useSelectWorkspaceDetail";
import { subscribeAppActive } from "../lib/appState";
import { uuidv4 } from "../lib/uuid";
import { useAtomCommand } from "../state/use-atom-command";
import { showCameraRefused } from "../lib/cameraRefused";
import { pickComposerMedia } from "../lib/composerImages";
import {
  appendComposerDraftAttachments,
  captureComposerDraftInsertion,
  createNewTaskDraft,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../state/use-composer-drafts";
import { journalLine } from "./home.logic";
import { noteSendOnOpen, noteWriteOnOpen } from "./sendOnOpen";
import { majordomeEnvironment } from "./state";
import { localDate, localTime, type TodayStore } from "./today.logic";
import { loadTodayStore, sendWaiting, updateTodayStore } from "./todayStore";

/**
 * Keeps words typed on home as a line of the journal, in the phone's own file until the computer
 * takes it: the same waiting lines the day's page writes and shows.
 */
export function useHomeJournal(
  vault: TodayStore["vault"],
  connected: boolean,
): (words: string) => void {
  const addToDailyNote = useAtomCommand(majordomeEnvironment.addToDailyNote, {
    reportFailure: false,
  });
  const flush = () =>
    void sendWaiting(async (capture) => {
      const result = await addToDailyNote({
        environmentId: capture.environmentId,
        input: {
          projectId: capture.projectId,
          date: capture.date,
          time: capture.time,
          text: capture.text,
        },
      });
      return result._tag === "Success";
    });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the phone's file once, outside React, and sends what waited when the app comes back to the front
  useEffect(() => {
    void loadTodayStore();
    return subscribeAppActive(flush);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `flush` is new each render and only reads the store and stable commands
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the computer coming back is outside React: send what waited for it
  useEffect(() => {
    if (connected) flush();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `flush` is new each render and only reads the store and stable commands
  }, [connected]);

  return (words) => {
    const text = journalLine(words);
    if (text === "" || vault === null) return;
    const now = new Date();
    updateTodayStore((current) => ({
      ...current,
      captures: [
        ...current.captures,
        { id: uuidv4(), ...vault, date: localDate(now), time: localTime(now), text },
      ],
    }));
    flush();
  };
}

/**
 * Home's one box, pinned under the list: what is typed goes to the assistant as a new chat, sent
 * as it opens. With no connection the words are kept as a line of the journal instead, so
 * nothing typed is lost.
 */
export function HomeAsk(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly connected: boolean;
  /** Keeps the words as a journal line, for when the assistant cannot be reached. */
  readonly onKeep: (text: string) => void;
}) {
  const { environmentId, projectId } = props;
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardState((keyboard) => keyboard.isVisible);
  const selectDetail = useSelectWorkspaceDetail();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const send = async () => {
    const prompt = text.trim();
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

  // A photo opens a new chat holding it and what was typed, unsent: a photo alone asks nothing.
  const takePhoto = async () => {
    const photo = await pickComposerMedia({ existingCount: 0, source: "camera" });
    if (photo.cameraRefused) showCameraRefused();
    if (photo.attachments.length === 0) {
      if (photo.error !== null) setNotice(photo.error);
      return;
    }
    try {
      await waitForComposerDraftsLoaded();
    } catch {
      setNotice("That photo couldn't be added. Try again.");
      return;
    }
    const words = text.trim();
    const draftId = createNewTaskDraft({ environmentId, projectId });
    setComposerDraftText(draftId, words);
    appendComposerDraftAttachments(draftId, photo.attachments, {
      appendReference: true,
      insertion: captureComposerDraftInsertion(draftId),
    });
    noteWriteOnOpen();
    setText("");
    setNotice(null);
    selectDetail({
      name: "Thread",
      params: { draft: { environmentId, projectId, draftId } },
    });
  };

  return (
    <View
      className="gap-1.5 border-t border-border bg-screen px-3.5 pt-2"
      // The keyboard covers the home indicator, so its room is only kept while the keyboard is away.
      style={{ paddingBottom: keyboardShown ? 8 : Math.max(insets.bottom, 12) }}
    >
      {notice === null ? null : (
        <Text
          accessibilityLiveRegion="polite"
          textRole="footnote"
          className="px-1.5 text-foreground-secondary"
        >
          {notice}
        </Text>
      )}
      <View className="flex-row items-end gap-2">
        <IconButton
          icon="camera"
          accessibilityLabel="Take a photo"
          disabled={!props.connected}
          onPress={() => void takePhoto()}
        />
        <View className="min-w-0 flex-1">
          <TextInput
            accessibilityLabel="Ask anything"
            placeholder="Ask anything…"
            multiline
            className="max-h-32 rounded-[22px]"
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
    </View>
  );
}
