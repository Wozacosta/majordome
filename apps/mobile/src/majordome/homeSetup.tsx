import { useAtomValue } from "@effect/atom-react";
import { EnvironmentId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Keyboard, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { hasAccountPublicConfig } from "../features/cloud/publicConfig";
import { openSettings } from "../features/settings/settings-navigation";
import { useEnvironmentQuery } from "../state/query";
import { AssistantSetup, FinishSetup } from "./FinishSetup";
import { HomeAsk, useHomeJournal } from "./homeAsk";
import { HomeHeader } from "./homeHeader";
import { majordomeEnvironment } from "./state";
import type { TodayStore } from "./today.logic";
import { useTodaySetup } from "./todaySetup";
import { todayStoreAtom } from "./todayStore";
import type { TodaySetup } from "./todayView.logic";
import { TodayWelcome } from "./TodayWelcome";
import { useVault } from "./useVault";
import { MajordomeWelcome } from "./Welcome";

// Fixed for a build: whether it has Majordome accounts to sign in to.
const hasAccounts = hasAccountPublicConfig();

export interface HomeSetup {
  readonly setup: TodaySetup;
  readonly vault: TodayStore["vault"];
  /** The notes folder's computer answers now. */
  readonly connected: boolean;
  readonly connectedComputer: string | null;
  readonly reconnect: () => void;
  readonly keep: (words: string) => void;
  /** The chats are what home shows: the notes are known, or nothing is known yet. */
  readonly showsList: boolean;
}

/** What home has to work with: the notes folder and its computer, or the one thing missing. */
export function useHomeSetup(): HomeSetup {
  const store = useAtomValue(todayStoreAtom);
  const { vault } = useVault(store);
  const { setup, reach, connectedComputer, reconnect } = useTodaySetup(store, vault);
  const connected = reach === "connected";
  const keep = useHomeJournal(vault, connected);
  return {
    setup,
    vault,
    connected,
    connectedComputer,
    reconnect,
    keep,
    showsList: setup === "ready" || setup === "starting",
  };
}

/** A new notes folder asks once what to call its owner, as a sheet over home. */
function HomeNameSheet(props: { readonly vault: NonNullable<TodayStore["vault"]> }) {
  const { vault } = props;
  const welcome = useEnvironmentQuery(
    majordomeEnvironment.welcome({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId },
    }),
  );
  if (!welcome.isSuccess || !welcome.data?.pending || (welcome.data.name ?? null) !== null) {
    return null;
  }
  return (
    <TodayWelcome
      key={`${vault.environmentId}:${vault.projectId}`}
      environmentId={vault.environmentId}
      projectId={vault.projectId}
    />
  );
}

/** Over home's chats: an AI's sign-in, only while the assistant cannot answer without one. */
export function HomeListTop(props: { readonly home: HomeSetup }) {
  const { vault, connected, setup } = props.home;
  if (setup !== "ready" || vault === null || !connected) return null;
  return (
    <View className="px-5 pb-2">
      <AssistantSetup environmentId={vault.environmentId} onlyWhenNeeded />
    </View>
  );
}

function HomeMissing(props: { readonly home: HomeSetup }) {
  const navigation = useNavigation();
  const { setup, connectedComputer, reconnect } = props.home;
  if (setup === "unreachable") {
    return (
      <View className="flex-1 justify-center px-5">
        <EmptyState
          title="Your computer can't be reached"
          detail="Check that it is on and that Majordome is open on it."
          action={
            <View className="gap-2">
              <Button label="Try again" tone="primary" icon="arrow.clockwise" onPress={reconnect} />
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
      </View>
    );
  }
  if (setup === "looking") {
    return <Text className="px-5 pt-3 text-foreground-muted">Looking for your notes…</Text>;
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerClassName="gap-5 px-5 pb-8 pt-3"
    >
      <Text textRole="headline" className="font-t3-bold text-foreground">
        Finish setting up
      </Text>
      {connectedComputer === null ? null : (
        <FinishSetup environmentId={EnvironmentId.make(connectedComputer)} />
      )}
    </ScrollView>
  );
}

/**
 * Home around its chats: the welcome page while no computer is paired; otherwise the title and
 * the Today strip fixed on top, the chats or the one thing missing in the middle, and the ask
 * box pinned at the bottom, above the keyboard.
 */
export function HomeFrame(props: {
  readonly home: HomeSetup;
  readonly onOpenSettings: () => void;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  /** The chats, drawn while `home.showsList`. */
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { home, onSearchQueryChange } = props;
  const [searchOpen, setSearchOpen] = useState(false);
  // A query still set, such as one typed before a chat was opened, keeps the field on screen.
  const searching = home.showsList && (searchOpen || props.searchQuery !== "");
  const navigation = useNavigation();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens to the navigator: a chat opened from a result covers home, and coming back shows home with the search closed
  useEffect(() => navigation.addListener("blur", () => setSearchOpen(false)), [navigation]);
  const closeSearch = useCallback(() => {
    onSearchQueryChange("");
    setSearchOpen(false);
    Keyboard.dismiss();
  }, [onSearchQueryChange]);
  if (home.setup === "noComputer") {
    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1 bg-screen"
        contentContainerClassName="px-5"
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: Math.max(insets.bottom, 18) + 24,
        }}
      >
        <MajordomeWelcome />
      </ScrollView>
    );
  }
  const ready = home.setup === "ready" && home.vault !== null;
  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-screen">
      <HomeHeader
        onOpenSettings={props.onOpenSettings}
        showsToday={ready}
        search={
          home.showsList
            ? {
                active: searching,
                value: props.searchQuery,
                onChangeText: onSearchQueryChange,
                onOpen: () => setSearchOpen(true),
                onClose: closeSearch,
              }
            : undefined
        }
      />
      <View className="flex-1">
        {home.showsList ? props.children : <HomeMissing home={home} />}
      </View>
      {ready && home.vault !== null ? (
        <>
          {searching ? null : (
            <HomeAsk
              environmentId={home.vault.environmentId}
              projectId={home.vault.projectId}
              connected={home.connected}
              onKeep={home.keep}
            />
          )}
          <HomeNameSheet vault={home.vault} />
        </>
      ) : null}
    </KeyboardAvoidingView>
  );
}
