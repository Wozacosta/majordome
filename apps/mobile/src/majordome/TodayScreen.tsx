import { useAuth, useUser } from "@clerk/expo";
import { useAtomValue } from "@effect/atom-react";
import { readAccountServers } from "@t3tools/shared/majordomeAccount";
import * as Cause from "effect/Cause";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { useAdaptiveWorkspaceLayout } from "../features/layout/adaptive-workspace-context";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { openSettings } from "../features/settings/settings-navigation";
import { subscribeAppActive } from "../lib/appState";
import { uuidv4 } from "../lib/uuid";
import { useThreadShells } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { MAJORDOME_WELCOME, welcomeAccountRow } from "./connectWording";
import { openSetupPage, SETUP_FAILED, SETUP_NOT_ALLOWED } from "./hostedSignup";
import { serverOfferAtom } from "./serverOffer";
import { majordomeEnvironment } from "./state";
import { TodayWelcome } from "./TodayWelcome";
import { MajordomeTodayTopics, useChatListTopics } from "./TopicsSection";
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
import {
  dayFromToday,
  dayTitle,
  FIRST_LINES,
  isFirstToday,
  noteStatus,
  shiftDay,
  todoProgress,
} from "./todayView.logic";

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

const MARK = {
  light: require("../../assets/majordome-splash-light.png"),
  dark: require("../../assets/majordome-splash-dark.png"),
};

/** One way to connect. */
function WayIn(props: {
  readonly icon: "person.crop.circle" | "qrcode.viewfinder" | "server.rack" | "desktopcomputer";
  /** The way most people take: drawn in the accent colour. */
  readonly main?: boolean;
  readonly title: string;
  readonly detail: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.title}. ${props.detail}`}
      onPress={props.onPress}
      className="flex-row items-center gap-4 px-4 py-3.5 active:opacity-70"
    >
      <SymbolView
        name={props.icon}
        size={24}
        tintColorClassName={props.main ? "accent-primary-text" : "accent-foreground"}
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text
          className={props.main ? "font-t3-bold text-foreground" : "font-t3-medium text-foreground"}
        >
          {props.title}
        </Text>
        <Text textRole="footnote" className="text-foreground-muted">
          {props.detail}
        </Text>
      </View>
      <SymbolView
        name="chevron.right"
        size={14}
        tintColorClassName={props.main ? "accent-primary-text" : "accent-foreground-muted"}
      />
    </Pressable>
  );
}

const SEPARATOR = <View className="ml-[60px] h-px bg-border" />;

/** A few ways in under the sentence that says who they are for. */
function WaysGroup(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View className="gap-2.5">
      <Text accessibilityRole="header" textRole="headline" className="px-1 font-t3-bold">
        {props.title}
      </Text>
      {props.children}
    </View>
  );
}

/**
 * The account's way in, above the code's. Rendered only in a build with accounts: the hooks need
 * its provider.
 */
function AccountWayIn(props: { readonly children: ReactNode }) {
  const navigation = useNavigation();
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();
  // No account row until the sign-in is known, so nobody signed in sees "Sign in" flash by.
  if (!isLoaded) return <ListSection>{props.children}</ListSection>;
  const row = welcomeAccountRow({
    signedIn: isSignedIn,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    computers: readAccountServers(user?.unsafeMetadata, { allowThisMachine: __DEV__ }).map(
      (server) => server.name,
    ),
  });
  const wayIn = (
    <WayIn
      main={row.main}
      icon="person.crop.circle"
      title={row.title}
      detail={row.detail}
      onPress={() => openSettings(navigation, "SettingsAccount")}
    />
  );
  return row.main ? (
    <>
      <View className="overflow-hidden rounded-[26px] border border-primary/40 border-continuous bg-primary/10">
        {wayIn}
      </View>
      <ListSection>{props.children}</ListSection>
    </>
  ) : (
    <ListSection>
      {wayIn}
      {SEPARATOR}
      {props.children}
    </ListSection>
  );
}

// The site's heading face, which iOS carries; Android has no match and falls back to its serif.
const SERIF = Platform.select({ ios: "Iowan Old Style", default: "serif" });

/** What a phone with no computer opens on: what Majordome is, in the site's voice, and the ways to connect it. */
function Welcome() {
  const navigation = useNavigation();
  const { themeAppearance } = useAppearancePreferences();
  const serverOffer = useAtomValue(serverOfferAtom);
  const scan = (
    <WayIn
      icon="qrcode.viewfinder"
      title={MAJORDOME_WELCOME.scan}
      detail={MAJORDOME_WELCOME.scanDetail}
      onPress={() => openSettings(navigation, "SettingsEnvironmentNew")}
    />
  );
  return (
    <View className="gap-8 pt-4">
      <View className="flex-row items-center gap-2">
        <Image
          accessibilityIgnoresInvertColors
          source={MARK[themeAppearance]}
          style={{ width: 40, height: 40 }}
        />
        <Text textRole="headline" className="font-t3-bold">
          Majordome
        </Text>
      </View>
      <View className="gap-5">
        <View accessible accessibilityRole="header" accessibilityLabel={MAJORDOME_WELCOME.spoken}>
          <Text className="text-[42px] leading-[46px]" style={{ fontFamily: SERIF }}>
            {MAJORDOME_WELCOME.headline}
          </Text>
          <View className="self-start">
            <View className="absolute inset-x-0 bottom-[5px] h-[16px] rounded-[4px] bg-[#3ddc8466]" />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              className="text-[42px] leading-[46px]"
              style={{ fontFamily: SERIF, fontStyle: "italic" }}
            >
              {MAJORDOME_WELCOME.headlineEnd}
            </Text>
          </View>
        </View>
        <Text textRole="headline" className="leading-relaxed text-foreground-muted">
          {MAJORDOME_WELCOME.what}
        </Text>
      </View>
      <View className="gap-6">
        <WaysGroup title={MAJORDOME_WELCOME.returning}>
          {hasAccounts ? <AccountWayIn>{scan}</AccountWayIn> : <ListSection>{scan}</ListSection>}
        </WaysGroup>
        <WaysGroup title={MAJORDOME_WELCOME.newHere}>
          <ListSection>
            <WayIn
              icon="desktopcomputer"
              title={MAJORDOME_WELCOME.computer}
              detail={MAJORDOME_WELCOME.computerDetail}
              onPress={() => openSettings(navigation, "SettingsUseComputer")}
            />
            {serverOffer === null ? null : (
              <>
                {SEPARATOR}
                <WayIn
                  icon="server.rack"
                  title={MAJORDOME_WELCOME.server}
                  detail={MAJORDOME_WELCOME.serverDetail}
                  onPress={() => openSettings(navigation, "SettingsHostedSignup")}
                />
              </>
            )}
          </ListSection>
        </WaysGroup>
      </View>
    </View>
  );
}

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
  const threads = useThreadShells();
  const chatTopics = useChatListTopics(threads, "");
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
  const first = isFirstToday({
    isToday,
    noteEmpty: sections.length === 0 && waiting.length === 0 && status.empty === "nothing",
    chats: threads.length,
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
    <SettingsScreen title={setup === "noComputer" ? "" : "Today"} workspaceRoot>
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
        {setup === "noComputer" ? null : (
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
        )}

        {setup === "starting" ? null : setup === "noComputer" ? (
          <Welcome />
        ) : setup === "unreachable" ? (
          <EmptyState
            title="Your computer can't be reached"
            detail="Check that it is on and that Majordome is open on it."
            action={
              <View className="gap-2">
                <Button
                  label="Try again"
                  tone="primary"
                  icon="arrow.clockwise"
                  onPress={tryAgain}
                />
                <View className="-ml-5 flex-row flex-wrap">
                  <Button
                    label="Your computers"
                    tone="text"
                    size="compact"
                    onPress={() => openSettings(navigation, "SettingsEnvironments")}
                  />
                  {hasAccounts ? (
                    <Button
                      label="Your account"
                      tone="text"
                      size="compact"
                      onPress={() => openSettings(navigation, "SettingsAccount")}
                    />
                  ) : null}
                </View>
              </View>
            }
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
                className="text-danger-foreground"
              >
                {problem}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            {isToday && vault !== null ? (
              <TodayWelcome
                key={`${vault.environmentId}:${vault.projectId}`}
                environmentId={vault.environmentId}
                projectId={vault.projectId}
              />
            ) : null}
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
                className="text-danger-foreground"
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

            {first ? (
              <>
                <ListSection title="Try a line">
                  {FIRST_LINES.map((line, index) => (
                    <View key={line}>
                      {index === 0 ? null : <View className="ml-4 h-px bg-border" />}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityHint="Writes it in the box"
                        onPress={() => setDraft(line)}
                        className="min-h-11 justify-center px-4 py-2.5 active:opacity-60"
                      >
                        <Text className="text-foreground">{line}</Text>
                      </Pressable>
                    </View>
                  ))}
                </ListSection>
                <MajordomeTodayTopics topics={chatTopics} />
              </>
            ) : sections.length === 0 && waiting.length === 0 && status.empty !== null ? (
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
