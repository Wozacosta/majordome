import { useAuth, useClerk, useUser } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native-components";
import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import { EnvironmentId, MAJORDOME_ACCOUNT_SIGN_IN_PATH } from "@t3tools/contracts";
import {
  ACCOUNT_TOKEN_OPTIONS,
  type AccountServer,
  readAccountServers,
  signInToAccountServer,
} from "@t3tools/shared/majordomeAccount";
import * as Haptics from "expo-haptics";
import { type ReactNode, useState } from "react";
import { Alert, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { hasAccountPublicConfig } from "../features/cloud/publicConfig";
import { useConnectionDiagnosis } from "../features/connection/ConnectionDiagnosisDetails";
import { buildPairingUrl } from "../features/connection/pairing";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { openSettings } from "../features/settings/settings-navigation";
import { environmentPresentations } from "../state/presentation";
import {
  pairEnvironment,
  savedConnectionsByIdAtom,
} from "../state/use-remote-environment-registry";
import { computerState, computerStateText } from "./connectionState";
import { accountConnectErrorForOwner, MAJORDOME_ACCOUNT, MAJORDOME_SERVER } from "./connectWording";
import { BROKER_URL } from "./hostedSignup";
import { serverOfferAtom } from "./serverOffer";
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

  // Only said after a check: the card above already says the account is empty.
  const [checkedOnce, setCheckedOnce] = useState(false);
  const checkAgain = async () => {
    setChecking(true);
    await user?.reload().catch(() => undefined);
    setChecking(false);
    setCheckedOnce(true);
  };

  return (
    <SettingsScreen title="Your account">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-2"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {email === null ? null : (
          <Text selectable className="text-foreground-muted">
            Signed in as {email}
          </Text>
        )}
        {servers.length === 0 ? (
          <View className="gap-3 rounded-[26px] border-continuous bg-grouped-card p-5">
            <Text textRole="headline" className="font-t3-bold text-foreground">
              {MAJORDOME_ACCOUNT.noComputerTitle}
            </Text>
            <Text className="text-foreground-muted">{MAJORDOME_ACCOUNT.noComputer}</Text>
            {checkedOnce && !checking ? (
              <Text accessibilityLiveRegion="polite" className="text-foreground">
                {MAJORDOME_ACCOUNT.stillNoComputer}
              </Text>
            ) : null}
            <Button
              label={MAJORDOME_ACCOUNT.checkAgain}
              tone="primary"
              icon="arrow.clockwise"
              loading={checking}
              onPress={() => void checkAgain()}
            />
            <Button
              label={MAJORDOME_ACCOUNT.codeInstead}
              tone="text"
              onPress={() => openSettings(navigation, "SettingsEnvironmentNew")}
            />
            {serverOffer === null ? null : (
              <Button
                label={MAJORDOME_SERVER.getLabel}
                tone="text"
                onPress={() => openSettings(navigation, "SettingsHostedSignup")}
              />
            )}
          </View>
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
        <Button label="Sign out" tone="text" onPress={() => void clerk.signOut()} />
        <Button
          label={MAJORDOME_ACCOUNT.deleteTitle}
          tone="text"
          loading={preparingDelete}
          onPress={() => void confirmDelete()}
        />
        {deleteProblem === null ? null : (
          <Text accessibilityRole="alert" className="text-danger">
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
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="text-danger">
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
