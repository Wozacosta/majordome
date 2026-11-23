import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../components/ui/AppActivityIndicator";
import { AppText as Text, AppTextInput as TextInput } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { environmentConnectedAtom } from "../state/use-remote-environment-registry";
import {
  finishHostedSignup,
  hostedSignupAtom,
  loadHostedSignup,
  openSetupPage,
  resetHostedSignup,
  retryPairing,
  SETUP_FAILED,
  SETUP_NOT_ALLOWED,
  submitInvite,
} from "./hostedSignup";

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

export function HostedSignupScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const state = useAtomValue(hostedSignupAtom);
  const [invite, setInvite] = useState("");

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the phone's file once, outside React, and clears a finished signup when the screen closes
  useEffect(() => {
    void loadHostedSignup();
    return resetHostedSignup;
  }, []);

  const canSubmit = state.step === "idle" && invite.trim().length > 0;
  const submit = () => {
    if (!canSubmit) return;
    void Haptics.selectionAsync();
    void submitInvite(invite);
  };

  const done = () => {
    finishHostedSignup();
    navigation.dispatch(StackActions.popToTop());
  };

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
          <Text className="text-foreground-muted">Your server is set up.</Text>
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
              This phone isn't connected to it yet. Your invite code is used, so there is no need to
              enter it again.
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
          <View className="gap-4">
            <Text className="text-foreground-muted">
              No computer to leave on? Majordome can keep a private server for you that is always
              on, so your notes and routines are there day and night. You sign in to your own Claude
              plan on it.
            </Text>
            <TextInput
              accessibilityLabel="Invite code"
              placeholder="Invite code"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              returnKeyType="go"
              editable={state.step === "idle"}
              value={invite}
              onChangeText={setInvite}
              onSubmitEditing={submit}
            />
            {state.step === "idle" ? (
              <Problem text={state.error} />
            ) : (
              <Progress text="Making your server. This takes about half a minute." />
            )}
            <Button label="Make my server" tone="primary" disabled={!canSubmit} onPress={submit} />
          </View>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
