import { useAuth, useClerk, useUser } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native-components";
import { useAtomValue } from "@effect/atom-react";
import { MAJORDOME_ACCOUNT_SIGN_IN_PATH } from "@t3tools/contracts";
import {
  ACCOUNT_TOKEN_OPTIONS,
  type AccountServer,
  readAccountServers,
  signInToAccountServer,
} from "@t3tools/shared/majordomeAccount";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { hasAccountPublicConfig } from "../features/cloud/publicConfig";
import { buildPairingUrl } from "../features/connection/pairing";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import {
  pairEnvironment,
  savedConnectionsByIdAtom,
} from "../state/use-remote-environment-registry";

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
  const clerk = useClerk();
  const { user } = useUser();
  const connections = useAtomValue(savedConnectionsByIdAtom);
  const servers = readAccountServers(user?.unsafeMetadata, { allowThisMachine: __DEV__ });
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

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
          <Text className="text-foreground-muted">
            No server is in your account yet. On your computer, open Majordome, go to Settings, then
            Your account, and add it.
          </Text>
        ) : (
          servers.map((server) => (
            <ServerCard
              key={server.environmentId}
              server={server}
              connected={server.environmentId in connections}
            />
          ))
        )}
        <Button label="Sign out" tone="text" onPress={() => void clerk.signOut()} />
      </ScrollView>
    </SettingsScreen>
  );
}

function ServerCard(props: { readonly server: AccountServer; readonly connected: boolean }) {
  const { server } = props;
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const connect = async (): Promise<string | null> => {
    const token = await getToken(ACCOUNT_TOKEN_OPTIONS);
    if (token === null) return "Sign in again, then try once more.";
    const signedIn = await signInToAccountServer({
      server,
      token,
      path: MAJORDOME_ACCOUNT_SIGN_IN_PATH,
      request: (url, init) => fetch(url, init),
    });
    if (!signedIn.ok) return signedIn.message;
    // The same spelling a scanned code is connected with.
    const outcome = await pairEnvironment(buildPairingUrl(server.url, signedIn.credential));
    return outcome.ok ? null : (outcome.error ?? `This phone couldn't connect to ${server.name}.`);
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
        <Text className="text-foreground-muted">This phone is connected to it.</Text>
      ) : (
        <Button label="Connect" tone="primary" loading={busy} onPress={() => void run()} />
      )}
    </View>
  );
}
