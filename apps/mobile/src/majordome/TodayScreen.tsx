import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { RefreshControl } from "../components/ui/RefreshControl";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { useAdaptiveWorkspaceLayout } from "../features/layout/adaptive-workspace-context";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { uuidv4 } from "../lib/uuid";
import { useProjects } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { majordomeEnvironment, vaultTopicsAtom } from "./state";
import {
  localDate,
  localTime,
  noteLines,
  toggleTodo,
  waitingFor,
  type TodayStore,
} from "./today.logic";
import { loadTodayStore, sendWaiting, todayStoreAtom, updateTodayStore } from "./todayStore";

/** The notes folder among the listed projects, or the one this phone last saw when offline. */
function useVault(store: TodayStore | null): TodayStore["vault"] {
  const projects = useProjects().filter((project) => !project.archivedAt && !project.isScratch);
  const key = JSON.stringify(projects.map((project) => [project.environmentId, project.id]));
  const topics = useAtomValue(vaultTopicsAtom(key));
  const found = projects.find(
    (_, index) =>
      topics[index] !== undefined && AsyncResult.getOrElse(topics[index], () => null)?.isVault,
  );
  const foundEnvironmentId = found?.environmentId;
  const foundProjectId = found?.id;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the found folder to the phone's file so Today opens offline
  useEffect(() => {
    if (foundEnvironmentId === undefined || foundProjectId === undefined) return;
    updateTodayStore((current) =>
      current.vault?.environmentId === foundEnvironmentId &&
      current.vault.projectId === foundProjectId
        ? current
        : { ...current, vault: { environmentId: foundEnvironmentId, projectId: foundProjectId } },
    );
  }, [foundEnvironmentId, foundProjectId]);
  return found
    ? { environmentId: found.environmentId, projectId: found.id }
    : (store?.vault ?? null);
}

export function MajordomeTodayScreen() {
  const insets = useSafeAreaInsets();
  const store = useAtomValue(todayStoreAtom);
  const { startNewTask } = useAdaptiveWorkspaceLayout();
  const [today, setToday] = useState(() => localDate(new Date()));
  const [draft, setDraft] = useState("");
  const vault = useVault(store);
  const note = useEnvironmentQuery(
    vault === null
      ? null
      : majordomeEnvironment.dailyNote({
          environmentId: vault.environmentId,
          input: { projectId: vault.projectId, date: today },
        }),
  );
  const addToDailyNote = useAtomCommand(majordomeEnvironment.addToDailyNote, {
    reportFailure: false,
  });
  const saveDailyNote = useAtomCommand(majordomeEnvironment.saveDailyNote);

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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the phone's file once, outside React
  useEffect(() => {
    void loadTodayStore();
  }, []);

  const answered = note.successResult;
  const loaded = store !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a fresh answer means the server is reachable: keep its note on the phone and send what waited
  useEffect(() => {
    if (!answered || !loaded) return;
    const content = answered.value.content;
    updateTodayStore((current) =>
      current.note?.date === today && current.note.content === content
        ? current
        : { ...current, note: { date: today, content } },
    );
    flush();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `flush` is new each render and only reads the store and stable commands
  }, [answered, loaded, today]);

  const content = note.isSuccess
    ? (note.data?.content ?? null)
    : store?.note?.date === today
      ? store.note.content
      : null;
  const lines = content === null ? [] : noteLines(content);
  const waiting = waitingFor(store?.captures ?? [], vault, today);
  // An unreachable server leaves the read pending for good; a line that stays waiting says so sooner.
  const offline = vault !== null && !note.isSuccess && (!note.isPending || waiting.length > 0);

  const add = () => {
    const text = draft.trim();
    if (text.length === 0 || vault === null) return;
    const now = new Date();
    updateTodayStore((current) => ({
      ...current,
      captures: [
        ...current.captures,
        { id: uuidv4(), ...vault, date: localDate(now), time: localTime(now), text },
      ],
    }));
    setDraft("");
    setToday(localDate(now));
    flush();
  };

  const tick = (index: number) => {
    if (vault === null || content === null || !note.isSuccess) return;
    void saveDailyNote({
      environmentId: vault.environmentId,
      input: {
        projectId: vault.projectId,
        date: today,
        content: toggleTodo(content, index),
        base: content,
      },
    });
  };

  return (
    <SettingsScreen title="Today" workspaceRoot>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 96 }}
        refreshControl={
          <RefreshControl
            // Never held open: with no connection the read does not come back.
            refreshing={false}
            onRefresh={() => {
              setToday(localDate(new Date()));
              note.refresh();
            }}
          />
        }
      >
        {loaded && vault === null ? (
          <Text className="text-foreground-muted">
            No notes folder yet. Open Majordome on your computer and choose one; it shows here once
            this phone is connected.
          </Text>
        ) : (
          <>
            <View className="gap-2">
              <TextInput
                accessibilityLabel="Add to today's note"
                className="min-h-20 rounded-xl border border-border-subtle px-3 py-2 text-base text-foreground"
                placeholderTextColorClassName="accent-foreground-muted"
                placeholder="Jot something down…"
                multiline
                value={draft}
                onChangeText={setDraft}
              />
              <View className="flex-row gap-2">
                <Button
                  label="Add to today's note"
                  onPress={add}
                  disabled={draft.trim().length === 0 || vault === null}
                />
                <Button label="Ask Majordome" tone="secondary" onPress={startNewTask} />
              </View>
            </View>

            {offline ? (
              <Text textRole="footnote" className="text-foreground-muted">
                Your computer can't be reached right now. What you add is kept on this phone and
                sent when it can.
              </Text>
            ) : null}

            {waiting.length > 0 ? (
              <View className="gap-1">
                <Text textRole="footnote" className="font-t3-medium text-foreground-muted">
                  Waiting to send
                </Text>
                {waiting.map((capture) => (
                  <Text key={capture.id} className="text-foreground-muted">
                    {capture.time} {capture.text}
                  </Text>
                ))}
              </View>
            ) : null}

            <View className="gap-2">
              {lines.length === 0 && waiting.length === 0 ? (
                <Text className="text-foreground-muted">
                  {content === null && offline
                    ? "Today's note will show here once your computer is reachable."
                    : "Nothing in today's note yet."}
                </Text>
              ) : null}
              {lines.map((line) =>
                line.kind === "heading" ? (
                  <Text
                    key={line.index}
                    textRole="headline"
                    className="pt-2 font-t3-bold text-foreground"
                  >
                    {line.text}
                  </Text>
                ) : line.kind === "todo" ? (
                  <Pressable
                    key={line.index}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: line.done, disabled: !note.isSuccess }}
                    className="flex-row items-start gap-2"
                    onPress={() => tick(line.index)}
                  >
                    <SymbolView
                      name={line.done ? "checkmark.circle.fill" : "circle"}
                      size={20}
                      tintColorClassName={line.done ? "accent-foreground-muted" : "accent-icon"}
                    />
                    <Text
                      className={
                        line.done
                          ? "flex-1 text-foreground-muted line-through"
                          : "flex-1 text-foreground"
                      }
                    >
                      {line.text}
                    </Text>
                  </Pressable>
                ) : (
                  <Text key={line.index} className="text-foreground">
                    {line.text}
                  </Text>
                ),
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
