import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { ListSection } from "../components/ui/ListSection";
import { RefreshControl } from "../components/ui/RefreshControl";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { useAdaptiveWorkspaceLayout } from "../features/layout/adaptive-workspace-context";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { subscribeAppActive } from "../lib/appState";
import { uuidv4 } from "../lib/uuid";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { majordomeEnvironment } from "./state";
import { useVault } from "./useVault";
import {
  friendlyDate,
  localDate,
  localTime,
  noteSections,
  toggleTodo,
  waitingFor,
  type NoteBodyLine,
} from "./today.logic";
import { loadTodayStore, sendWaiting, todayStoreAtom, updateTodayStore } from "./todayStore";

const INDENT = 22;
const MAX_DEPTH = 4;

function NoteLineRow(props: {
  readonly line: NoteBodyLine;
  readonly canTick: boolean;
  readonly onTick: (index: number) => void;
}) {
  const { line } = props;
  if (line.kind === "heading") {
    return (
      <Text accessibilityRole="header" className="pt-3 pb-1 font-t3-medium text-foreground">
        {line.text}
      </Text>
    );
  }
  const indent = { paddingLeft: Math.min(line.depth, MAX_DEPTH) * INDENT };
  if (line.kind === "todo") {
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={line.text}
        accessibilityState={{ checked: line.done, disabled: !props.canTick }}
        accessibilityHint={
          props.canTick ? undefined : "Can be ticked once your computer is reachable"
        }
        disabled={!props.canTick}
        className={
          props.canTick
            ? "min-h-11 flex-row items-center gap-3 active:opacity-60"
            : "min-h-11 flex-row items-center gap-3 opacity-60"
        }
        style={indent}
        onPress={() => props.onTick(line.index)}
      >
        <SymbolView
          name={line.done ? "checkmark.circle.fill" : "circle"}
          size={24}
          tintColorClassName={line.done ? "accent-icon-muted" : "accent-icon"}
        />
        <Text
          className={
            line.done
              ? "flex-1 py-2 text-foreground-muted line-through"
              : "flex-1 py-2 text-foreground"
          }
        >
          {line.text}
        </Text>
      </Pressable>
    );
  }
  if (line.kind === "bullet") {
    return (
      <View className="flex-row gap-2 py-1.5" style={indent}>
        <Text className="text-foreground-muted">•</Text>
        <Text className="flex-1 text-foreground">{line.text}</Text>
      </View>
    );
  }
  return (
    <Text className="py-1.5 text-foreground" style={indent}>
      {line.text}
    </Text>
  );
}

export function MajordomeTodayScreen() {
  const insets = useSafeAreaInsets();
  const store = useAtomValue(todayStoreAtom);
  const { startNewTask } = useAdaptiveWorkspaceLayout();
  const [today, setToday] = useState(() => localDate(new Date()));
  const [draft, setDraft] = useState("");
  const { vault } = useVault(store);
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
  const saveDailyNote = useAtomCommand(majordomeEnvironment.saveDailyNote, {
    reportFailure: false,
  });
  // The note as the owner's ticks leave it, shown over the last read (`over`) until a fresh one lands.
  const [edit, setEdit] = useState<{
    readonly shown: string;
    readonly over: string | null;
    readonly saving: boolean;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const saves = useRef<Promise<boolean>>(Promise.resolve(true));

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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the app coming back to the front is outside React: the day may have changed and the computer may be reachable again
  useEffect(
    () =>
      subscribeAppActive(() => {
        setToday(localDate(new Date()));
        flush();
      }),
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `flush` is new each render and only reads the store and stable commands
    [],
  );

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

  const read = note.isSuccess
    ? (note.data?.content ?? null)
    : store?.note?.date === today
      ? store.note.content
      : null;
  if (edit !== null && !edit.saving && read !== edit.over) setEdit(null);
  const content = edit === null ? read : edit.shown;
  const sections = content === null ? [] : noteSections(content, today);
  const waiting = waitingFor(store?.captures ?? [], vault, today);
  // An unreachable server leaves the read pending for good; a line that stays waiting says so sooner.
  const offline = vault !== null && !note.isSuccess && (!note.isPending || waiting.length > 0);
  const canAdd = draft.trim().length > 0 && vault !== null;

  const add = () => {
    // One line in the note: a pasted line break would start a second, untimed one.
    const text = draft.trim().replace(/\s*\n\s*/g, " ");
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
    setProblem(null);
    setToday(localDate(now));
    void Haptics.selectionAsync();
    flush();
  };

  const tick = (index: number) => {
    if (vault === null || content === null || !note.isSuccess) return;
    const next = toggleTodo(content, index);
    if (next === content) return;
    void Haptics.selectionAsync();
    setProblem(null);
    setEdit({ shown: next, over: read, saving: true });
    const input = { projectId: vault.projectId, date: today, content: next, base: content };
    // Each save starts from what the one before it wrote, so ticks made in a row go out in order.
    const before = edit === null ? Promise.resolve(true) : saves.current;
    saves.current = before.then(async (carryOn) => {
      if (!carryOn) return false;
      const result = await saveDailyNote({ environmentId: vault.environmentId, input });
      if (result._tag === "Success") {
        setEdit((current) => (current?.shown === next ? { ...current, saving: false } : current));
        return true;
      }
      const error = Cause.squash(result.cause);
      const changed =
        typeof error === "object" && error !== null && "reason" in error
          ? error.reason === "changed"
          : false;
      setEdit(null);
      setProblem(
        changed
          ? "That tick wasn't saved: the note changed on your computer in the meantime. This is the latest version, so you can tick it again."
          : "That tick couldn't be saved. Check that your computer is on and reachable, then try again.",
      );
      note.refresh();
      return false;
    });
  };

  return (
    <SettingsScreen title="Today" workspaceRoot>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-2"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 96 }}
        refreshControl={
          <RefreshControl
            // Never held open: with no connection the read does not come back.
            refreshing={false}
            onRefresh={() => {
              setToday(localDate(new Date()));
              setProblem(null);
              note.refresh();
              flush();
            }}
          />
        }
      >
        <Text accessibilityRole="header" textRole="largeTitle" className="font-t3-bold">
          {friendlyDate(today)}
        </Text>

        {store === null ? null : vault === null ? (
          <Text className="text-foreground-muted">
            No notes folder yet. Open Majordome on your computer and choose one; it shows here once
            this phone is connected.
          </Text>
        ) : (
          <>
            <View className="gap-2">
              <TextInput
                accessibilityLabel="Add a line to today's note"
                placeholder="Add a line to today's note…"
                multiline
                // Return adds the line and puts the keyboard away; a line break has no place in one line.
                submitBehavior="blurAndSubmit"
                returnKeyType="done"
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={add}
              />
              <View className="flex-row items-center justify-between gap-2">
                <Button
                  label="Add to note"
                  accessibilityLabel="Add to today's note"
                  tone="primary"
                  size="compact"
                  onPress={add}
                  disabled={!canAdd}
                />
                <Button
                  label="Ask Majordome"
                  accessibilityHint="Starts a new chat"
                  tone="text"
                  size="compact"
                  onPress={startNewTask}
                />
              </View>
            </View>

            {offline ? (
              <View className="flex-row gap-2" accessibilityRole="text">
                <SymbolView name="wifi.slash" size={16} tintColorClassName="accent-icon-muted" />
                <Text textRole="footnote" className="flex-1 text-foreground-secondary">
                  Your computer can't be reached right now. What you add is kept on this phone and
                  sent when it can.
                </Text>
              </View>
            ) : null}

            {problem !== null ? (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                textRole="footnote"
                className="text-danger"
              >
                {problem}
              </Text>
            ) : null}

            {waiting.length > 0 ? (
              <ListSection title="Waiting to send">
                <View className="px-4 py-2">
                  {waiting.map((capture) => (
                    <View key={capture.id} className="flex-row gap-3 py-1.5">
                      <Text className="text-foreground-muted">{capture.time}</Text>
                      <Text className="flex-1 text-foreground">{capture.text}</Text>
                    </View>
                  ))}
                </View>
              </ListSection>
            ) : null}

            {sections.length === 0 && waiting.length === 0 ? (
              <Text className="text-foreground-muted">
                {content !== null || note.isSuccess
                  ? "Nothing in today's note yet. Add a line above to start it."
                  : offline
                    ? "Today's note will show here once your computer is reachable."
                    : "Getting today's note…"}
              </Text>
            ) : null}

            {sections.map((section) =>
              section.lines.length === 0 ? (
                <Text
                  key={section.index}
                  accessibilityRole="header"
                  textRole="footnote"
                  className="px-2 font-t3-medium text-foreground-muted"
                >
                  {section.title}
                </Text>
              ) : (
                <ListSection key={section.index} title={section.title ?? undefined}>
                  <View className="px-4 py-2">
                    {section.lines.map((line) => (
                      <NoteLineRow
                        key={line.index}
                        line={line}
                        canTick={note.isSuccess}
                        onTick={tick}
                      />
                    ))}
                  </View>
                </ListSection>
              ),
            )}
          </>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
