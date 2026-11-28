import { useAuth, useClerk, useUser } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native-components";
import { useAtomValue } from "@effect/atom-react";
import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { EnvironmentId, MAJORDOME_ACCOUNT_SIGN_IN_PATH } from "@t3tools/contracts";
import {
  ACCOUNT_TOKEN_OPTIONS,
  type AccountServer,
  readAccountServers,
  signInToAccountServer,
} from "@t3tools/shared/majordomeAccount";
import * as Haptics from "expo-haptics";
import { type ReactNode, useCallback, useState } from "react";
import { Alert, AppState, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { ListActionRow } from "../components/ui/ListActionRow";
import { ListRow } from "../components/ui/ListRow";
import { ListSection } from "../components/ui/ListSection";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { environmentCatalog } from "../connection/catalog";
import { hasAccountPublicConfig } from "../features/cloud/publicConfig";
import { useConnectionDiagnosis } from "../features/connection/ConnectionDiagnosisDetails";
import { buildPairingUrl } from "../features/connection/pairing";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { openSettings } from "../features/settings/settings-navigation";
import { environmentPresentations } from "../state/presentation";
import { useAtomCommand } from "../state/use-atom-command";
import {
  pairEnvironment,
  savedConnectionsByIdAtom,
} from "../state/use-remote-environment-registry";
import { computerState, computerStateText } from "./connectionState";
import {
  accountConnectErrorForOwner,
  accountSignInStep,
  MAJORDOME_ACCOUNT,
  MAJORDOME_SERVER,
  MAJORDOME_WELCOME,
} from "./connectWording";
import { BROKER_URL, connectToServer, manageSubscription } from "./hostedSignup";
import { forgetPhonePushOn } from "./phonePush";
import { accountHasServerAtom, serverOfferAtom } from "./serverOffer";
import { Step } from "./Step";
import { deleteAccountDetail, endServerBilling, readBillingStatus } from "./serverPurchase.logic";

// A build with no account service has no way in here.
export function AccountScreen() {
  return hasAccountPublicConfig() ? <ConfiguredAccountScreen /> : null;
}

function ConfiguredAccountScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  if (!isLoaded) return <View className="flex-1 bg-sheet" />;
  if (!isSignedIn) {
    return (
      <View collapsable={false} className="flex-1 overflow-hidden bg-sheet">
        {/* No host back button: the navigator's own header already has one. */}
        <AuthView isDismissible={false} />
      </View>
    );
  }
  return <SignedIn />;
}

function SignedIn() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const clerk = useClerk();
  const { user } = useUser();
  const { getToken } = useAuth();
  const serverOffer = useAtomValue(serverOfferAtom);
  const ownsServer = useAtomValue(accountHasServerAtom);
  const connections = useAtomValue(savedConnectionsByIdAtom);
  const servers = readAccountServers(user?.unsafeMetadata, { allowThisMachine: __DEV__ });
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const [checking, setChecking] = useState(false);
  // A phone's first computer is what it came here for: Today can show its notes now.
  const leaveOnceConnected =
    Object.keys(connections).length === 0
      ? () => navigation.dispatch(StackActions.popToTop())
      : undefined;

  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);
  const [preparingDelete, setPreparingDelete] = useState(false);
  // The account's server goes first: once the account is gone, nothing could ask for that.
  const deleteAccount = async () => {
    setDeleteProblem(null);
    const token = await getToken(ACCOUNT_TOKEN_OPTIONS).catch(() => null);
    const serverEnded = token !== null && (await endServerBilling(fetch, BROKER_URL, token));
    const deleted =
      serverEnded &&
      (await user?.delete().then(
        () => true,
        () => false,
      ));
    if (!deleted) setDeleteProblem(MAJORDOME_ACCOUNT.deleteFailed);
  };
  const confirmDelete = async () => {
    setPreparingDelete(true);
    const token = await getToken(ACCOUNT_TOKEN_OPTIONS).catch(() => null);
    const detail =
      token === null
        ? MAJORDOME_ACCOUNT.deleteDetail
        : deleteAccountDetail(await readBillingStatus(fetch, BROKER_URL, token));
    setPreparingDelete(false);
    Alert.alert(MAJORDOME_ACCOUNT.deleteTitle, detail, [
      { text: "Cancel", style: "cancel" },
      {
        text: MAJORDOME_ACCOUNT.deleteConfirm,
        style: "destructive",
        onPress: () => void deleteAccount(),
      },
    ]);
  };

  const removeEnvironment = useAtomCommand(environmentCatalog.remove, "environment remove");
  const signOut = () => {
    // Signing out leaves a clean phone: a connection is the phone's own and outlives the
    // sign-in, so any computer left would show its notes to whoever signs in next.
    const removing = Object.keys(connections).map((id) =>
      forgetPhonePushOn(id).then(() => removeEnvironment(EnvironmentId.make(id))),
    );
    void Promise.allSettled(removing).then(() => clerk.signOut());
  };

  // Only said after a check: the steps above already say what is missing.
  const [checkedOnce, setCheckedOnce] = useState(false);
  const checkAgain = async () => {
    setChecking(true);
    await user?.reload().catch(() => undefined);
    setChecking(false);
    setCheckedOnce(true);
  };
  const waitingForComputer = servers.length === 0 && !ownsServer;
  // The steps happen on another device, often with this phone put down meanwhile: coming back
  // to the app asks the account again without a press.
  useFocusEffect(
    useCallback(() => {
      if (!waitingForComputer) return;
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void user?.reload().catch(() => undefined);
      });
      return () => subscription.remove();
    }, [waitingForComputer, user]),
  );

  return (
    <SettingsScreen title="Your account">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-2"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {servers.length === 0 && ownsServer ? (
          <View className="gap-3 rounded-[26px] border-continuous bg-grouped-card p-5">
            <Text textRole="headline" className="font-t3-bold text-foreground">
              {MAJORDOME_ACCOUNT.yourServer}
            </Text>
            <Button
              label={MAJORDOME_SERVER.connect}
              tone="primary"
              onPress={() => {
                openSettings(navigation, "SettingsHostedSignup");
                void connectToServer();
              }}
            />
          </View>
        ) : servers.length === 0 ? (
          <>
            <Text accessibilityRole="header" textRole="title" className="px-1 font-t3-bold">
              {MAJORDOME_ACCOUNT.noComputerTitle}
            </Text>
            <View className="overflow-hidden rounded-[26px] border border-primary/40 border-continuous bg-primary/10">
              <View className="gap-4 p-5">
                <View className="flex-row items-center gap-3">
                  <SymbolView
                    name="desktopcomputer"
                    size={22}
                    tintColorClassName="accent-primary-text"
                  />
                  <Text textRole="headline" className="font-t3-bold text-foreground">
                    {MAJORDOME_ACCOUNT.onComputer}
                  </Text>
                </View>
                {[...MAJORDOME_ACCOUNT.noComputerSteps, accountSignInStep(email)].map(
                  (text, index) => (
                    <Step key={text} number={index + 1} text={text} />
                  ),
                )}
                {checkedOnce && !checking ? (
                  <Text accessibilityLiveRegion="polite" className="text-foreground">
                    {MAJORDOME_ACCOUNT.stillNoComputer}
                  </Text>
                ) : null}
                <Button
                  label={checkedOnce ? MAJORDOME_ACCOUNT.checkAgain : MAJORDOME_ACCOUNT.signedIn}
                  tone="primary"
                  fullWidth
                  loading={checking}
                  onPress={() => void checkAgain()}
                />
              </View>
              <View className="h-px bg-primary/20" />
              <Pressable
                accessibilityRole="button"
                className="min-h-14 flex-row items-center gap-3 px-5 active:opacity-70"
                onPress={() => openSettings(navigation, "SettingsEnvironmentNew")}
              >
                <SymbolView
                  name="qrcode.viewfinder"
                  size={22}
                  tintColorClassName="accent-primary-text"
                />
                <Text className="flex-1 font-t3-medium text-primary-text">
                  {MAJORDOME_ACCOUNT.codeInstead}
                </Text>
                <SymbolView
                  name="chevron.right"
                  size={14}
                  tintColorClassName="accent-primary-text"
                />
              </Pressable>
            </View>
            {serverOffer === null ? null : (
              <ListSection>
                <ListRow
                  icon="server.rack"
                  label={MAJORDOME_SERVER.getLabel}
                  description={MAJORDOME_WELCOME.serverDetail}
                  onPress={() => openSettings(navigation, "SettingsHostedSignup")}
                />
              </ListSection>
            )}
          </>
        ) : (
          servers.map((server) => (
            <ServerCard
              key={server.environmentId}
              server={server}
              connected={server.environmentId in connections}
              onConnected={leaveOnceConnected}
            />
          ))
        )}
        <ListSection>
          {serverOffer === null ? null : (
            <ListActionRow
              icon="creditcard"
              label={MAJORDOME_SERVER.manage}
              onPress={manageSubscription}
            />
          )}
          <ListActionRow
            icon="rectangle.portrait.and.arrow.right"
            label={MAJORDOME_ACCOUNT.signOut}
            description={email ?? undefined}
            onPress={signOut}
          />
        </ListSection>
        <ListSection>
          <ListActionRow
            icon="trash"
            tone="danger"
            label={MAJORDOME_ACCOUNT.deleteTitle}
            loading={preparingDelete}
            onPress={() => void confirmDelete()}
          />
        </ListSection>
        {deleteProblem === null ? null : (
          <Text accessibilityRole="alert" className="text-danger-foreground">
            {deleteProblem}
          </Text>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

function ServerCard(props: {
  readonly server: AccountServer;
  readonly connected: boolean;
  /** Called after this phone connected, when there is somewhere better to be than this list. */
  readonly onConnected: (() => void) | undefined;
}) {
  const { server } = props;
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const connect = async (): Promise<string | null> => {
    const token = await getToken(ACCOUNT_TOKEN_OPTIONS);
    if (token === null) return MAJORDOME_ACCOUNT.sessionEnded;
    const signedIn = await signInToAccountServer({
      server,
      token,
      path: MAJORDOME_ACCOUNT_SIGN_IN_PATH,
      request: (url, init) => fetch(url, init),
    });
    if (!signedIn.ok) return signedIn.message;
    // The same spelling a scanned code is connected with.
    const outcome = await pairEnvironment(
      buildPairingUrl(server.url, signedIn.credential),
      props.connected ? EnvironmentId.make(server.environmentId) : undefined,
    );
    if (outcome.ok) return null;
    return outcome.error === null
      ? `This phone couldn't connect to ${server.name}.`
      : accountConnectErrorForOwner(outcome.error, server.name);
  };

  const run = async () => {
    setBusy(true);
    setProblem(null);
    const failure = await connect();
    setBusy(false);
    setProblem(failure);
    void Haptics.notificationAsync(
      failure === null
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    );
    if (failure === null) props.onConnected?.();
  };

  return (
    <View className="gap-3 rounded-[26px] border-continuous bg-grouped-card p-5">
      <View className="gap-1">
        <Text textRole="headline" className="font-t3-bold text-foreground">
          {server.name}
        </Text>
        <Text selectable className="text-sm text-foreground-muted">
          {new URL(server.url).host}
        </Text>
      </View>
      {problem === null ? null : (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="text-danger-foreground"
        >
          {problem}
        </Text>
      )}
      {props.connected ? (
        <SavedServer
          server={server}
          again={
            <Button
              label={MAJORDOME_ACCOUNT.connectAgain}
              tone="primary"
              loading={busy}
              onPress={() => void run()}
            />
          }
        />
      ) : (
        <Button label="Connect" tone="primary" loading={busy} onPress={() => void run()} />
      )}
    </View>
  );
}

/** A server this phone already has: how the connection stands, and the way back in when the server let it go. */
function SavedServer(props: { readonly server: AccountServer; readonly again: ReactNode }) {
  const environmentId = EnvironmentId.make(props.server.environmentId);
  const presentation = useAtomValue(environmentPresentations.presentationAtom(environmentId));
  const { state } = useConnectionDiagnosis(environmentId, presentation);
  const stands = computerState({
    enabled: presentation?.entry.enabled ?? true,
    phase: presentation?.connection.phase ?? "connecting",
    network: state.network,
    failure: state.lastFailure,
  });
  if (stands === null) {
    return <Text className="text-foreground-muted">{MAJORDOME_ACCOUNT.connected}</Text>;
  }
  if (stands === "signInExpired") return props.again;
  return (
    <Text className="text-foreground-muted">
      {computerStateText(stands, props.server.name).sentence}
    </Text>
  );
}
