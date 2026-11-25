import { useAuth } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native-components";
import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../components/ui/AppActivityIndicator";
import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { hasAccountPublicConfig } from "../features/cloud/publicConfig";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { tryOpenExternalUrl } from "../lib/openExternalUrl";
import { environmentConnectedAtom } from "../state/use-remote-environment-registry";
import { MAJORDOME_SERVER } from "./connectWording";
import {
  buyServer,
  connectToServer,
  finishHostedSignup,
  hostedSignupAtom,
  loadHostedSignup,
  openSetupPage,
  resetHostedSignup,
  restoreServer,
  retryPairing,
  SETUP_FAILED,
  SETUP_NOT_ALLOWED,
} from "./hostedSignup";
import type { SignupNote } from "./hostedSignup.logic";
import { serverOfferAtom } from "./serverOffer";

function Progress(props: { readonly text: string }) {
  return (
    <View className="flex-row items-center gap-3" accessibilityRole="text">
      <AppActivityIndicator colorClassName="accent-foreground-muted" />
      <Text accessibilityLiveRegion="polite" className="flex-1 text-foreground">
        {props.text}
      </Text>
    </View>
  );
}

function Problem(props: { readonly text: string | null }) {
  return props.text === null ? null : (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="text-danger">
      {props.text}
    </Text>
  );
}

function FinishSettingUp(props: { readonly environmentId: string; readonly onDone: () => void }) {
  const connected = useAtomValue(environmentConnectedAtom(EnvironmentId.make(props.environmentId)));
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const open = async () => {
    setOpening(true);
    setProblem(null);
    const result = await openSetupPage(props.environmentId);
    setOpening(false);
    if (result === "opened") setOpened(true);
    else setProblem(result === "notAllowed" ? SETUP_NOT_ALLOWED : SETUP_FAILED);
  };

  return (
    <View className="gap-4">
      <Text accessibilityRole="header" textRole="headline" className="font-t3-bold text-foreground">
        Your server is ready
      </Text>
      <Text className="text-foreground-muted">
        This phone is connected to it. One step is left, in your browser: sign in to Claude and
        start your notes there, then come back.
      </Text>
      {connected ? null : <Progress text="Connecting to your server…" />}
      <Problem text={problem} />
      <Button
        label={opened ? "Open it again" : "Finish setting up"}
        tone={opened ? "secondary" : "primary"}
        icon="safari"
        loading={opening}
        disabled={!connected}
        onPress={() => void open()}
      />
      {opened ? <Button label="Done" tone="primary" onPress={props.onDone} /> : null}
    </View>
  );
}

function Note(props: { readonly note: SignupNote | null }) {
  if (props.note === null) return null;
  return props.note.kind === "error" ? (
    <Problem text={props.note.message} />
  ) : (
    <Text accessibilityLiveRegion="polite" className="text-foreground">
      {props.note.message}
    </Text>
  );
}

/** What a server is, what it costs in the App Store's own words, and the ways to get one. */
function Offer(props: { readonly note: SignupNote | null; readonly onSignIn: () => void }) {
  const { isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const offer = useAtomValue(serverOfferAtom);
  const run = (action: () => Promise<void>) => () => {
    void Haptics.selectionAsync();
    void action();
  };

  return (
    <View className="gap-4">
      <Text className="text-foreground-muted">{MAJORDOME_SERVER.what}</Text>
      <Text className="text-foreground-muted">{MAJORDOME_SERVER.ownPlan}</Text>
      {offer === null ? null : (
        <View className="gap-2 rounded-[26px] border-continuous bg-grouped-card p-5">
          <Text textRole="headline" className="font-t3-bold text-foreground">
            {offer.trial ?? offer.price}
          </Text>
          <Text className="text-sm text-foreground-muted">{MAJORDOME_SERVER.renews}</Text>
        </View>
      )}
      <Note note={props.note} />
      {!isSignedIn ? (
        <>
          <Text className="text-foreground-muted">{MAJORDOME_SERVER.signInHelp}</Text>
          <Button
            label={MAJORDOME_SERVER.signIn}
            tone="primary"
            icon="person.crop.circle"
            onPress={props.onSignIn}
          />
        </>
      ) : props.note?.kind === "hasServer" ? (
        <Button label={MAJORDOME_SERVER.connect} tone="primary" onPress={run(connectToServer)} />
      ) : offer === null ? null : (
        <Button label={MAJORDOME_SERVER.buy} tone="primary" onPress={run(buyServer)} />
      )}
      {isSignedIn && offer !== null ? (
        <Button label={MAJORDOME_SERVER.restore} tone="text" onPress={run(restoreServer)} />
      ) : null}
      <View className="flex-row justify-center gap-4">
        <Button
          label={MAJORDOME_SERVER.terms}
          tone="text"
          size="compact"
          onPress={() => void tryOpenExternalUrl("https://majord.me/terms")}
        />
        <Button
          label={MAJORDOME_SERVER.privacy}
          tone="text"
          size="compact"
          onPress={() => void tryOpenExternalUrl("https://majord.me/privacy")}
        />
      </View>
    </View>
  );
}

// Buying takes a Majordome account, so a build without them has no way in here.
export function HostedSignupScreen() {
  return hasAccountPublicConfig() ? <ConfiguredHostedSignupScreen /> : null;
}

function ConfiguredHostedSignupScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const state = useAtomValue(hostedSignupAtom);
  const { isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const [signingIn, setSigningIn] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the phone's file once, outside React, and clears what the last try said when the screen closes
  useEffect(() => {
    void loadHostedSignup();
    return resetHostedSignup;
  }, []);

  const done = () => {
    finishHostedSignup();
    navigation.dispatch(StackActions.popToTop());
  };

  // Signing in ends this by itself: the offer is back the moment the account is.
  if (signingIn && !isSignedIn) {
    return (
      <View collapsable={false} className="flex-1 overflow-hidden bg-sheet">
        <AuthView isDismissible={false} />
      </View>
    );
  }

  return (
    <SettingsScreen title="A Majordome server">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-2"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {state.step === "finishing" ? (
          <FinishSettingUp environmentId={state.environmentId} onDone={done} />
        ) : state.step === "done" ? (
          <View className="gap-4">
            <Text className="text-foreground">This phone is connected to your server.</Text>
            <Button label="Done" tone="primary" onPress={done} />
          </View>
        ) : state.step === "paying" ? (
          <Progress text={MAJORDOME_SERVER[state.doing]} />
        ) : state.step === "making" ? (
          <Progress text={MAJORDOME_SERVER.making} />
        ) : state.step === "waiting" || state.step === "pairing" ? (
          <Progress
            text={
              state.step === "waiting"
                ? "Your server is made. Waiting for it to start…"
                : "Connecting this phone to your server…"
            }
          />
        ) : state.step === "made" ? (
          <View className="gap-4">
            <Text
              accessibilityRole="header"
              textRole="headline"
              className="font-t3-bold text-foreground"
            >
              Your server is made
            </Text>
            <Text className="text-foreground-muted">
              This phone isn't connected to it yet. Nothing more is to pay.
            </Text>
            <Problem text={state.error} />
            <Button
              label={state.error === null ? "Connect this phone" : "Try again"}
              tone="primary"
              icon="arrow.clockwise"
              onPress={() => void retryPairing()}
            />
          </View>
        ) : (
          <Offer note={state.note} onSignIn={() => setSigningIn(true)} />
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
