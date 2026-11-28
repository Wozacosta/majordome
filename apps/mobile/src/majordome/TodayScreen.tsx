import { useAtomValue } from "@effect/atom-react";
import { EnvironmentId, type ScheduledTask } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import * as Dialog from "../components/ui/Dialog";
import { IconButton } from "../components/ui/IconButton";
import { ListSection } from "../components/ui/ListSection";
import { Menu } from "../components/ui/Menu";
import { RefreshControl } from "../components/ui/RefreshControl";
import { RowPressable } from "../components/ui/RowPressable";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { useSelectWorkspaceDetail } from "../features/layout/workspace/useSelectWorkspaceDetail";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { useScheduledTaskEditor } from "../features/settings/scheduled-task-editor";
import { editDraft } from "../features/settings/scheduledTaskDraft";
import { subscribeAppActive } from "../lib/appState";
import { uuidv4 } from "../lib/uuid";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useWorkspaceEnvironments } from "../state/workspace";
import {
  routineRows,
  routinesForDay,
  routineStatus,
  withRoutineHidden,
  type RoutineRow,
} from "./routine.logic";
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
import { sendWaiting, todayStoreAtom, updateTodayStore } from "./todayStore";
import { useKeepToday } from "./todaySummary";
import {
  dayFromToday,
  daySheet,
  dayTitle,
  noteStatus,
  shiftDay,
  timedLine,
  todoProgress,
  type TodoLine,
} from "./todayView.logic";

const INDENT = 22;
const MAX_DEPTH = 4;
const NO_ROUTINES: ReadonlyArray<never> = [];

function TodoRow(props: {
  readonly line: TodoLine;
  readonly canTick: boolean;
  readonly onTick: (index: number) => void;
}) {
  const { line } = props;
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

function JournalLineRow(props: { readonly line: NoteBodyLine }) {
  const { line } = props;
  if (line.kind === "heading") {
    return (
      <Text accessibilityRole="header" className="pt-3 pb-1 font-t3-medium text-foreground">
        {line.text}
      </Text>
    );
  }
  if (line.kind === "todo") return null;
  const indent = { paddingLeft: Math.min(line.depth, MAX_DEPTH) * INDENT };
  if (line.kind === "bullet") {
    const timed = timedLine(line.text);
    return (
      <View className={timed ? "flex-row gap-3 py-1.5" : "flex-row gap-2 py-1.5"} style={indent}>
        <Text className="text-foreground-muted">{timed ? timed.time : "•"}</Text>
        <Text className="flex-1 text-foreground">{timed ? timed.text : line.text}</Text>
      </View>
    );
  }
  return (
    <Text className="py-1.5 text-foreground" style={indent}>
      {line.text}
    </Text>
  );
}

function RoutineLine(props: {
  readonly routine: RoutineRow;
  readonly status: string | null;
  readonly warning: boolean;
  readonly hidden: boolean;
  readonly canRun: boolean;
  readonly canEdit: boolean;
  readonly onOpen: (routine: RoutineRow) => void;
  readonly onAction: (routine: RoutineRow, action: string) => void;
}) {
  const { routine } = props;
  const opens = routine.threadId !== null || props.canEdit;
  return (
    <Menu
      shouldOpenOnLongPress
      actions={[
        { id: "run", title: "Run now", attributes: { disabled: !props.canRun } },
        { id: "edit", title: "Edit", attributes: { disabled: !props.canEdit } },
        props.hidden
          ? { id: "show", title: "Show in Chats" }
          : { id: "hide", title: "Hide from Chats" },
      ]}
      onPressAction={({ nativeEvent }) => props.onAction(routine, nativeEvent.event)}
    >
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={
          props.status === null ? routine.title : `${routine.title}, ${props.status}`
        }
        disabled={!opens}
        onPress={() => props.onOpen(routine)}
      >
        <View className="min-h-11 flex-row items-center gap-3 px-4 py-2">
          <Text
            numberOfLines={1}
            className={props.hidden ? "flex-1 text-foreground-muted" : "flex-1 text-foreground"}
          >
            {routine.title}
          </Text>
          {props.status === null ? null : (
            <Text
              textRole="footnote"
              className={props.warning ? "text-warning-foreground" : "text-foreground-muted"}
            >
              {props.status}
            </Text>
          )}
          {routine.threadId === null ? null : (
            <SymbolView name="chevron.right" size={12} tintColorClassName="accent-icon-muted" />
          )}
        </View>
      </RowPressable>
    </Menu>
  );
}

/** The day's routines: how each one went or when it runs next, with the way to its chat. */
function TodayRoutines(props: {
  readonly environmentId: EnvironmentId;
  readonly routines: ReadonlyArray<RoutineRow>;
  /** The computer's own list, which editing needs; null with no connection. */
  readonly tasks: ReadonlyArray<ScheduledTask> | null;
  readonly hiddenTitles: ReadonlyArray<string>;
  readonly day: string;
  readonly today: string;
  readonly connected: boolean;
}) {
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const { startEditor, draftForEnvironment } = useScheduledTaskEditor();
  const environmentLabel =
    useWorkspaceEnvironments().find(
      (environment) => environment.environmentId === props.environmentId,
    )?.environmentLabel ?? "";
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, { reportFailure: false });
  const [unfolded, setUnfolded] = useState(false);
  const { shown, hidden } = routinesForDay(
    props.routines,
    props.day,
    props.today,
    props.hiddenTitles,
  );
  const canAdd = props.connected && props.day === props.today;
  if (shown.length === 0 && hidden.length === 0 && !canAdd) return null;

  const taskOf = (routine: RoutineRow) =>
    props.tasks?.find((task) => String(task.id) === routine.id) ?? null;
  const edit = (routine: RoutineRow) => {
    const task = taskOf(routine);
    if (task === null) return;
    startEditor({ environmentId: props.environmentId, environmentLabel, draft: editDraft(task) });
    navigation.navigate("SettingsScheduledTaskEdit");
  };
  const open = (routine: RoutineRow) => {
    if (routine.threadId === null) return edit(routine);
    selectDetail({
      name: "Thread",
      params: { environmentId: String(props.environmentId), threadId: routine.threadId },
    });
  };
  const act = (routine: RoutineRow, action: string) => {
    if (action === "edit") return edit(routine);
    if (action === "hide" || action === "show") {
      updateTodayStore((current) => ({
        ...current,
        hiddenRoutines: withRoutineHidden(
          current.hiddenRoutines ?? [],
          routine.title,
          action === "hide",
        ),
      }));
      return;
    }
    const task = taskOf(routine);
    if (action !== "run" || task === null) return;
    void Haptics.selectionAsync();
    void runNow({ environmentId: props.environmentId, input: { id: task.id } }).then((result) => {
      if (result._tag === "Success") return;
      Dialog.alert(
        `Couldn't run ${routine.title}`,
        "Check that your computer is on and reachable, then try again.",
      );
    });
  };
  const line = (routine: RoutineRow, isHidden: boolean) => {
    const status = routineStatus(routine, props.day, props.today);
    return (
      <RoutineLine
        key={routine.id}
        routine={routine}
        status={status?.text ?? null}
        warning={status?.tone === "warning"}
        hidden={isHidden}
        canRun={props.connected && taskOf(routine) !== null}
        canEdit={props.connected && taskOf(routine) !== null}
        onOpen={open}
        onAction={act}
      />
    );
  };

  return (
    <ListSection title="Routines">
      {shown.map((routine) => line(routine, false))}
      {hidden.length === 0 ? null : (
        <RowPressable
          accessibilityRole="button"
          accessibilityLabel={`${hidden.length} hidden`}
          accessibilityState={{ expanded: unfolded }}
          onPress={() => setUnfolded((value) => !value)}
        >
          <View className="min-h-11 flex-row items-center px-4 py-2">
            <Text textRole="footnote" className="text-foreground-muted">
              {`${hidden.length} hidden`}
            </Text>
          </View>
        </RowPressable>
      )}
      {unfolded ? hidden.map((routine) => line(routine, true)) : null}
      {canAdd ? (
        <RowPressable
          accessibilityRole="button"
          onPress={() => {
            startEditor({
              environmentId: props.environmentId,
              environmentLabel,
              draft: draftForEnvironment(props.environmentId),
            });
            navigation.navigate("SettingsScheduledTaskNew");
          }}
        >
          <View className="min-h-11 flex-row items-center gap-3 px-4 py-2">
            <SymbolView name="plus" size={16} tintColorClassName="accent-icon" />
            <Text className="text-foreground">Add a routine</Text>
          </View>
        </RowPressable>
      ) : null}
    </ListSection>
  );
}

/** The box that stays at the foot of the page, over the keyboard when it is up. */
function WriteBar(props: { readonly children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const padding = Math.max(insets.bottom, 12);
  return (
    <KeyboardStickyView offset={{ closed: 0, opened: padding - 8 }}>
      {/* Solid, as home's box is: the page's own surface lets the rows under it show through. */}
      <View
        className="gap-1 border-t border-border bg-screen px-4 pt-2"
        style={{ paddingBottom: padding }}
      >
        {props.children}
      </View>
    </KeyboardStickyView>
  );
}

const NOTICES = {
  connecting: "Connecting to your computer…",
  unreachable: "Your computer can't be reached.",
  failed: "This day's note couldn't be read.",
} as const;

export function MajordomeTodayScreen() {
  const store = useAtomValue(todayStoreAtom);
  const [today, setToday] = useState(() => localDate(new Date()));
  // Null follows the calendar, so a screen left open overnight moves on to the new day.
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const isToday = day === today;
  const [draft, setDraft] = useState("");
  const [pulled, setPulled] = useState(false);
  const { vault } = useVault(store);
  const { setup, reach, reconnect } = useTodaySetup(store, vault);
  useKeepToday(today);
  const note = useEnvironmentQuery(
    vault === null
      ? null
      : majordomeEnvironment.dailyNote({
          environmentId: vault.environmentId,
          input: { projectId: vault.projectId, date: day },
        }),
  );
  const tasks = useEnvironmentQuery(
    vault === null
      ? null
      : serverEnvironment.scheduledTasksLive({ environmentId: vault.environmentId, input: {} }),
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a fresh answer or the computer coming back means it is reachable: send what waited for it
  useEffect(() => {
    if (loaded && (answered !== null || reach === "connected")) flush();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `flush` is new each render and only reads the store and stable commands
  }, [answered, loaded, reach]);

  const kept = store?.note?.date === day ? store.note : null;
  const read = note.isSuccess ? (note.data?.content ?? null) : (kept?.content ?? null);
  if (edit !== null && !edit.saving && (edit.date !== day || read !== edit.over)) setEdit(null);
  const content = edit !== null && edit.date === day ? edit.shown : read;
  const sections = content === null ? [] : noteSections(content, day);
  const sheet = daySheet(sections);
  const waiting = waitingFor(store?.captures ?? [], vault, day);
  const routines = tasks.data ? routineRows(tasks.data.tasks) : (store?.routines ?? NO_ROUTINES);
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
    // The line goes to today's note, so show it landing there.
    show(localDate(now));
    flush();
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

  // Home says what is missing before there is a notes folder; this page only has a day to show after.
  if (setup !== "ready" || vault === null) {
    return (
      <SettingsScreen title="Today">
        {setup === "starting" ? null : (
          <Text className="px-5 pt-4 text-foreground-muted">
            {setup === "looking"
              ? "Looking for your notes…"
              : "Your day shows here once your notes are set up."}
          </Text>
        )}
      </SettingsScreen>
    );
  }

  return (
    <SettingsScreen title="Today">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-2 pb-6"
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
          </View>
          {away !== null || progress !== null ? (
            <Text textRole="footnote" className="text-foreground-secondary">
              {[
                away,
                progress === null ? null : `${progress.done} of ${progress.total} to-dos done`,
              ]
                .filter((part) => part !== null)
                .join(" · ")}
            </Text>
          ) : null}
        </View>

        {status.notice !== null ? (
          <View className="flex-row items-center gap-2" accessibilityRole="text">
            <SymbolView
              name={status.notice === "failed" ? "exclamationmark.triangle" : "wifi.slash"}
              size={16}
              tintColorClassName="accent-icon-muted"
            />
            <Text textRole="footnote" className="flex-1 text-foreground-secondary">
              {NOTICES[status.notice]}
            </Text>
            {status.notice === "connecting" ? null : (
              <Button label="Try again" tone="text" size="compact" onPress={tryAgain} />
            )}
          </View>
        ) : null}

        {problem !== null ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            textRole="footnote"
            className="text-danger-foreground"
          >
            {problem}
          </Text>
        ) : null}

        {sheet.todos.length > 0 ? (
          <ListSection title="To do">
            <View className="px-4 py-2">
              {sheet.todos.map((line) => (
                <TodoRow key={line.index} line={line} canTick={status.canTick} onTick={tick} />
              ))}
            </View>
          </ListSection>
        ) : null}

        <TodayRoutines
          environmentId={vault.environmentId}
          routines={routines}
          tasks={tasks.data?.tasks ?? null}
          hiddenTitles={store?.hiddenRoutines ?? NO_ROUTINES}
          day={day}
          today={today}
          connected={reach === "connected"}
        />

        {sheet.journal.length > 0 || waiting.length > 0 ? (
          <ListSection title="Journal">
            <View className="px-4 py-2">
              {sheet.journal.map((section) => (
                <View key={section.index}>
                  {section.title === null ? null : (
                    <Text
                      accessibilityRole="header"
                      textRole="footnote"
                      className="pt-2 pb-1 font-t3-medium text-foreground-muted"
                    >
                      {section.title}
                    </Text>
                  )}
                  {section.lines.map((line) => (
                    <JournalLineRow key={line.index} line={line} />
                  ))}
                </View>
              ))}
              {waiting.map((capture) => (
                <View
                  key={capture.id}
                  accessible
                  accessibilityLabel={`${capture.time} ${capture.text}, waiting to send`}
                  className="flex-row items-center gap-3 py-1.5"
                >
                  <Text className="text-foreground-muted">{capture.time}</Text>
                  <Text className="flex-1 text-foreground-secondary">{capture.text}</Text>
                  <SymbolView name="clock" size={14} tintColorClassName="accent-icon-muted" />
                </View>
              ))}
            </View>
          </ListSection>
        ) : sheet.todos.length === 0 && status.empty !== null ? (
          <Text className="text-foreground-muted">
            {status.empty === "getting"
              ? "Getting your lines…"
              : status.empty === "later"
                ? "Your lines will show here once your computer is reachable."
                : isToday
                  ? "Nothing written today yet."
                  : "Nothing written for this day yet."}
          </Text>
        ) : null}
      </ScrollView>
      <WriteBar>
        {isToday ? null : (
          <Button
            label="Back to today"
            tone="text"
            size="compact"
            icon="arrow.uturn.backward"
            onPress={() => show(today)}
          />
        )}
        <View className="flex-row items-end gap-2">
          <TextInput
            accessibilityLabel={isToday ? "Write a line" : "Write a line for today"}
            placeholder={isToday ? "Write a line…" : "Write a line for today…"}
            multiline
            // Return adds the line and puts the keyboard away; a line break has no place in one line.
            submitBehavior="blurAndSubmit"
            returnKeyType="done"
            className="max-h-32 flex-1"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
          />
          <Button label="Add" tone="primary" onPress={add} disabled={!canAdd} />
        </View>
      </WriteBar>
    </SettingsScreen>
  );
}
