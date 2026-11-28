import { useNavigation } from "@react-navigation/native";
import { useEffect } from "react";
import { BackHandler, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { useContentTopInset } from "../components/ui/useBarInset";
import { openToday } from "./homeNavigation";
import { useTodaySummary } from "./todaySummary";

/** The day in one line, fixed under home's title; a tap opens the day's page. */
export function TodayStrip() {
  const navigation = useNavigation();
  const summary = useTodaySummary();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={summary === null ? "Today" : `Today, ${summary}`}
      onPress={() => openToday(navigation)}
      className="min-h-11 flex-row items-center gap-2.5 rounded-2xl border border-primary/25 bg-primary/10 px-3.5 active:opacity-70"
    >
      <SymbolView name="sun.max" size={17} tintColorClassName="accent-primary-text" />
      <Text className="font-t3-bold text-sm text-foreground">Today</Text>
      <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground-secondary">
        {summary ?? ""}
      </Text>
      <SymbolView name="chevron.right" size={12} tintColorClassName="accent-chevron" />
    </Pressable>
  );
}

/**
 * The top of home: its title, search and the way into Settings, and the Today strip once there
 * are notes. Searching turns the title row into the search field, with Cancel as the way out.
 */
export function HomeHeader(props: {
  readonly onOpenSettings: () => void;
  readonly showsToday: boolean;
  /** Absent while there is no list to search. */
  readonly search?:
    | {
        readonly active: boolean;
        readonly value: string;
        readonly onChangeText: (value: string) => void;
        readonly onOpen: () => void;
        readonly onClose: () => void;
      }
    | undefined;
}) {
  const insets = useSafeAreaInsets();
  const iosTopInset = useContentTopInset();
  const navigation = useNavigation();
  const { search } = props;
  const searching = search?.active === true;
  const closeSearch = search?.onClose;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to Android's back button while searching, so back leaves the search before it leaves home
  useEffect(() => {
    if (!searching || closeSearch === undefined) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // A home covered by a chat keeps its effects; back is the chat's then.
      if (!navigation.isFocused()) return false;
      closeSearch();
      return true;
    });
    return () => subscription.remove();
  }, [searching, closeSearch, navigation]);

  return (
    <View
      className="gap-2.5 px-5 pb-2"
      style={{ paddingTop: (Platform.OS === "ios" ? iosTopInset : insets.top) + 8 }}
    >
      {search !== undefined && searching ? (
        <View className="min-h-11 flex-row items-center gap-1">
          <View className="min-w-0 flex-1">
            <TextInput
              accessibilityLabel="Search chats and topics"
              placeholder="Search"
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              className="min-h-10 rounded-full py-2"
              value={search.value}
              onChangeText={search.onChangeText}
            />
          </View>
          <Button label="Cancel" tone="text" size="compact" onPress={search.onClose} />
        </View>
      ) : (
        <View className="min-h-11 flex-row items-center gap-2">
          <Text
            accessibilityRole="header"
            textRole="largeTitle"
            numberOfLines={1}
            className="min-w-0 flex-1 font-t3-bold text-foreground"
          >
            Majordome
          </Text>
          {search === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search"
              hitSlop={8}
              onPress={search.onOpen}
              className="size-9 items-center justify-center rounded-full bg-subtle active:opacity-70"
            >
              <SymbolView name="magnifyingglass" size={17} tintColorClassName="accent-icon" />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={8}
            onPress={props.onOpenSettings}
            className="size-9 items-center justify-center rounded-full bg-subtle active:opacity-70"
          >
            <SymbolView name="gearshape" size={18} tintColorClassName="accent-icon" />
          </Pressable>
        </View>
      )}
      {props.showsToday && !searching ? <TodayStrip /> : null}
    </View>
  );
}
