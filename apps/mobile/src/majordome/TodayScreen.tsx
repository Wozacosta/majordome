import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { IconButton } from "../components/ui/IconButton";
import { ListSection } from "../components/ui/ListSection";
import { RefreshControl } from "../components/ui/RefreshControl";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { hasAccountPublicConfig } from "../features/cloud/publicConfig";
import { useAdaptiveWorkspaceLayout } from "../features/layout/adaptive-workspace-context";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { openSettings } from "../features/settings/settings-navigation";
import { subscribeAppActive } from "../lib/appState";
import { uuidv4 } from "../lib/uuid";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { openSetupPage, SETUP_FAILED, SETUP_NOT_ALLOWED } from "./hostedSignup";
import { majordomeEnvironment } from "./state";
import { useVault } from "./useVault";
import {
  localDate,
  localTime,
  noteSections,
  toggleTodo,
  waitingFor,
  type NoteBodyLine,
} from "./today.logic";
import { useTodaySetup } from "./todaySetup";
import { loadTodayStore, sendWaiting, todayStoreAtom, updateTodayStore } from "./todayStore";
import { dayFromToday, dayTitle, noteStatus, shiftDay, todoProgress } from "./todayView.logic";

// Fixed for a build: whether it has Majordome accounts to sign in to.
const hasAccounts = hasAccountPublicConfig();
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

const NOTICES = {
  connecting: "Connecting to your computer…",
  unreachable: "Your computer can't be reached right now.",
  failed: "This day's note couldn't be read.",
} as const;

export function MajordomeTodayScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const store = useAtomValue(todayStoreAtom);
  const { startNewTask } = useAdaptiveWorkspaceLayout();
  const [today, setToday] = useState(() => localDate(new Date()));
  // Null follows the calendar, so a screen left open overnight moves on to the new day.
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const isToday = day === today;
  const [draft, setDraft] = useState("");
  const [pulled, setPulled] = useState(false);
  const { vault } = useVault(store);
  const { setup, reach, connectedComputer, reconnect } = useTodaySetup(store, vault);
  const [settingUp, setSettingUp] = useState(false);
  const note = useEnvironmentQuery(
    vault === null
      ? null
      : majordomeEnvironment.dailyNote({
          environmentId: vault.environmentId,
          input: { projectId: vault.projectId, date: day },
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
    readonly date: string;
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a fresh answer means the server is reachable: keep today's note on the phone and send what waited
  useEffect(() => {
    if (!answered || !loaded) return;
    const content = answered.value.content;
    // Only today's note is kept: it is the one the phone opens on with no connection.
    if (isToday) {
      updateTodayStore((current) =>
        current.note?.date === day && current.note.content === content
          ? current
          : { ...current, note: { date: day, content } },
      );
    }
    flush();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `flush` is new each render and only reads the store and stable commands
  }, [answered, loaded, day, isToday]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the computer coming back is outside React: send what waited for it
  useEffect(() => {
    if (reach === "connected") flush();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `flush` is new each render and only reads the store and stable commands
  }, [reach]);

  const kept = store?.note?.date === day ? store.note : null;
  const read = note.isSuccess ? (note.data?.content ?? null) : (kept?.content ?? null);
  if (edit !== null && !edit.saving && (edit.date !== day || read !== edit.over)) setEdit(null);
  const content = edit !== null && edit.date === day ? edit.shown : read;
  const sections = content === null ? [] : noteSections(content, day);
  const waiting = waitingFor(store?.captures ?? [], vault, day);
  const status = noteStatus({
    reach,
    read: note.isSuccess
      ? "answered"
      : note.isPending || note.failure === null
        ? "waiting"
        : "failed",
    hasNote: kept !== null,
  });
  const progress = todoProgress(sections);
  const away = dayFromToday(day, today);
  const canAdd = draft.trim().length > 0 && vault !== null;
  // The pull's own turn only: later reads happen quietly, and none is waited for without a connection.
  const refreshing = pulled && reach === "connected" && note.isPending;
  if (pulled && !refreshing) setPulled(false);

  const show = (next: string) => {
    const now = localDate(new Date());
    setToday(now);
    setPicked(next === now ? null : next);
    setProblem(null);
    void Haptics.selectionAsync();
  };

  const tryAgain = () => {
    setToday(localDate(new Date()));
    setProblem(null);
    reconnect();
    note.refresh();
    flush();
  };

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

  const finishSettingUp = async () => {
    if (connectedComputer === null) return;
    setSettingUp(true);
    setProblem(null);
    const result = await openSetupPage(connectedComputer);
    setSettingUp(false);
    if (result !== "opened") setProblem(result === "notAllowed" ? SETUP_NOT_ALLOWED : SETUP_FAILED);
  };

  const tick = (index: number) => {
    if (vault === null || content === null || !status.canTick) return;
    const next = toggleTodo(content, index);
    if (next === content) return;
    void Haptics.selectionAsync();
    setProblem(null);
    setEdit({ date: day, shown: next, over: read, saving: true });
    const input = { projectId: vault.projectId, date: day, content: next, base: content };
    // Each save starts from what the one before it wrote, so ticks made in a row go out in order.
    const before = edit === null || edit.date !== day ? Promise.resolve(true) : saves.current;
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
      setEdit((current) => (current?.date === input.date ? null : current));
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
            refreshing={refreshing}
            onRefresh={() => {
              tryAgain();
              setPulled(true);
            }}
          />
        }
      >
        <View className="gap-1">
          <View className="flex-row items-center gap-1">
            <Text
              accessibilityRole="header"
              textRole="largeTitle"
              className="min-w-0 flex-1 font-t3-bold"
            >
              {dayTitle(day, today)}
            </Text>
            {setup === "ready" ? (
              <>
                <IconButton
                  icon="chevron.left"
                  accessibilityLabel="Previous day"
                  onPress={() => show(shiftDay(day, -1))}
                />
                <IconButton
                  icon="chevron.right"
                  accessibilityLabel="Next day"
                  onPress={() => show(shiftDay(day, 1))}
                />
              </>
            ) : null}
          </View>
          {setup === "ready" && (away !== null || progress !== null) ? (
            <Text textRole="footnote" className="text-foreground-secondary">
              {[
                away,
                progress === null ? null : `${progress.done} of ${progress.total} to-dos done`,
              ]
                .filter((part) => part !== null)
                .join(" · ")}
            </Text>
          ) : null}
          {setup === "ready" && !isToday ? (
            <Button
              label="Back to today"
              tone="text"
              icon="arrow.uturn.backward"
              onPress={() => show(today)}
            />
          ) : null}
        </View>

        {setup === "starting" ? null : setup === "noComputer" ? (
          <EmptyState
            title="Add your computer"
            detail={
              hasAccounts
                ? "Your notes live on your computer. Sign in with the Majordome account you use there, and this phone finds it. No account? Scan the code your computer shows. No computer to leave on? Majordome can also run on a Majordome server that is always on: sign in and it is here."
                : "Your notes live on your computer. Add it to this phone to see today's note here. No computer to leave on? Majordome can also run on a Majordome server that is always on."
            }
            action={
              <View className="gap-2">
                {hasAccounts ? (
                  <Button
                    label="Sign in"
                    tone="primary"
                    icon="person.crop.circle"
                    onPress={() => openSettings(navigation, "SettingsAccount")}
                  />
                ) : null}
                <Button
                  label={hasAccounts ? "Scan a code instead" : "Add a computer"}
                  tone={hasAccounts ? "secondary" : "primary"}
                  onPress={() => openSettings(navigation, "SettingsEnvironmentNew")}
                />
              </View>
            }
          />
        ) : setup === "unreachable" ? (
          <EmptyState
            title="Your computer can't be reached"
            detail="Check that it is on and that Majordome is open on it."
            actionLabel="Try again"
            onAction={tryAgain}
          />
        ) : setup === "looking" ? (
          <Text className="text-foreground-muted">Looking for your notes…</Text>
        ) : setup === "noFolder" ? (
          <>
            <EmptyState
              title="No notes folder yet"
              detail="Finish setting up in your browser: sign in to Claude and start your notes there, then come back. If Majordome is on your computer, you can also choose a notes folder there."
              action={
                <Button
                  label="Finish setting up"
                  tone="primary"
                  icon="safari"
                  loading={settingUp}
                  onPress={() => void finishSettingUp()}
                />
              }
            />
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
          </>
        ) : (
          <>
            {isToday ? (
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
                <View className="flex-row flex-wrap items-center justify-between gap-2">
                  <Button
                    label="Add to note"
                    accessibilityLabel="Add to today's note"
                    tone="primary"
                    onPress={add}
                    disabled={!canAdd}
                  />
                  <Button
                    label="Ask Majordome"
                    accessibilityHint="Starts a new chat"
                    tone="text"
                    onPress={startNewTask}
                  />
                </View>
              </View>
            ) : null}

            {status.notice !== null ? (
              <View className="gap-2">
                <View className="flex-row gap-2" accessibilityRole="text">
                  <SymbolView
                    name={status.notice === "failed" ? "exclamationmark.triangle" : "wifi.slash"}
                    size={16}
                    tintColorClassName="accent-icon-muted"
                  />
                  <Text textRole="footnote" className="flex-1 text-foreground-secondary">
                    {NOTICES[status.notice]}
                    {status.notice !== "failed" && isToday
                      ? " What you add is kept on this phone and sent when it can."
                      : ""}
                  </Text>
                </View>
                {status.notice === "connecting" ? null : (
                  <Button label="Try again" icon="arrow.clockwise" onPress={tryAgain} />
                )}
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

            {sections.length === 0 && waiting.length === 0 && status.empty !== null ? (
              <Text className="text-foreground-muted">
                {status.empty === "getting"
                  ? "Getting the note…"
                  : status.empty === "later"
                    ? "The note will show here once your computer is reachable."
                    : isToday
                      ? "Nothing in today's note yet. Add a line above to start it."
                      : "Nothing written for this day yet."}
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
                        canTick={status.canTick}
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
