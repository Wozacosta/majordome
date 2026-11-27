import { useAuth, useUser } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native-components";
import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { type ReactNode, useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../components/ui/AppActivityIndicator";
import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { hasAccountPublicConfig } from "../features/cloud/publicConfig";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { openSettings } from "../features/settings/settings-navigation";
import { cn } from "../lib/cn";
import { tryOpenExternalUrl } from "../lib/openExternalUrl";
import { environmentConnectedAtom } from "../state/use-remote-environment-registry";
import { MAJORDOME_SERVER, MAJORDOME_SERVER_ON_WEB } from "./connectWording";
import { FinishSetup } from "./FinishSetup";
import {
  buyServer,
  connectToServer,
  finishHostedSignup,
  hostedSignupAtom,
  loadHostedSignup,
  manageSubscription,
  resetHostedSignup,
  restoreServer,
  retryPairing,
  SOLD_ON_WEB,
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

function Problem(props: { readonly text: string | null; readonly centered?: boolean }) {
  return props.text === null ? null : (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className={cn("text-danger-foreground", props.centered && "text-center")}
    >
      {props.text}
    </Text>
  );
}

function FinishSettingUp(props: { readonly environmentId: string; readonly onDone: () => void }) {
  const environmentId = EnvironmentId.make(props.environmentId);
  const connected = useAtomValue(environmentConnectedAtom(environmentId));

  return (
    <View className="gap-4">
      <Text accessibilityRole="header" textRole="headline" className="font-t3-bold text-foreground">
        Your server is ready
      </Text>
      {connected ? (
        <FinishSetup environmentId={environmentId} onDone={props.onDone} />
      ) : (
        <Progress text="Connecting to your server…" />
      )}
    </View>
  );
}

function Note(props: { readonly note: SignupNote | null }) {
  if (props.note === null) return null;
  return props.note.kind === "error" ? (
    <Problem text={props.note.message} centered />
  ) : (
    <Text accessibilityLiveRegion="polite" className="text-center text-foreground">
      {props.note.message}
    </Text>
  );
}

function ServerCard(props: {
  readonly icon: "server.rack" | "internaldrive";
  readonly main: boolean;
  readonly name: string;
  readonly recommended?: string;
  readonly price: string | null;
  readonly what: string;
  readonly children: ReactNode;
}) {
  return (
    <View className="gap-4 rounded-[26px] border-continuous bg-grouped-card p-5">
      <View className="flex-row items-center gap-3">
        <View
          className={cn(
            "size-11 items-center justify-center rounded-[14px] border-continuous",
            props.main ? "bg-primary" : "bg-subtle",
          )}
        >
          <SymbolView
            name={props.icon}
            size={22}
            tintColorClassName={props.main ? "accent-primary-foreground" : "accent-primary-text"}
          />
        </View>
        <View className="flex-1 gap-0.5">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text
              accessibilityRole="header"
              textRole="headline"
              className="font-t3-bold text-foreground"
            >
              {props.name}
            </Text>
            {props.recommended === undefined ? null : (
              <Chip label={props.recommended} selected size="small" />
            )}
          </View>
          {props.price === null ? null : (
            <Text textRole="footnote" className="text-foreground-muted">
              {props.price}
            </Text>
          )}
        </View>
      </View>
      <Text className="text-foreground">{props.what}</Text>
      {props.children}
    </View>
  );
}

/** The two ways to have a server: your own first, then the one Majordome sells here. */
function Offer(props: { readonly note: SignupNote | null; readonly onSignIn: () => void }) {
  const { isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const offer = useAtomValue(serverOfferAtom);
  const email = useUser().user?.primaryEmailAddress?.emailAddress;
  const run = (action: () => Promise<void>) => () => {
    void Haptics.selectionAsync();
    void action();
  };
  const { own, hosted } = MAJORDOME_SERVER;

  return (
    <View className="gap-4">
      <View className="gap-2 pb-2 pt-4">
        <Text
          accessibilityRole="header"
          textRole="largeTitle"
          className="text-center font-t3-bold text-foreground"
        >
          {MAJORDOME_SERVER.headline}
        </Text>
        <Text className="text-center text-foreground-muted">{MAJORDOME_SERVER.what}</Text>
      </View>
      <ServerCard
        icon="internaldrive"
        main={false}
        name={own.name}
        recommended={own.recommended}
        price={own.price}
        what={own.what}
      >
        <Button
          label={own.guide}
          tone="secondary"
          icon="safari"
          fullWidth
          onPress={() => void tryOpenExternalUrl(own.guideUrl)}
        />
      </ServerCard>
      <ServerCard
        icon="server.rack"
        main
        name={hosted.name}
        price={offer === null ? null : (offer.trial ?? offer.price)}
        what={hosted.what}
      >
        <Note note={props.note} />
        {props.note?.kind === "hasServer" && isSignedIn ? (
          <Button
            label={MAJORDOME_SERVER.connect}
            tone="primary"
            fullWidth
            onPress={run(connectToServer)}
          />
        ) : offer === null ? null : isSignedIn ? (
          <>
            <View className="flex-row items-center justify-center gap-2">
              <SymbolView
                name="checkmark.circle.fill"
                size={16}
                tintColorClassName="accent-primary-text"
              />
              <Text textRole="footnote" numberOfLines={1} className="shrink text-foreground-muted">
                {email ?? MAJORDOME_SERVER.signedIn}
              </Text>
            </View>
            <Button
              label={MAJORDOME_SERVER.buy}
              tone="primary"
              fullWidth
              onPress={run(buyServer)}
            />
          </>
        ) : (
          <>
            <Button
              label={`1. ${MAJORDOME_SERVER.signIn}`}
              tone="primary"
              fullWidth
              onPress={props.onSignIn}
            />
            <Button
              label={`2. ${MAJORDOME_SERVER.buy}`}
              tone="secondary"
              fullWidth
              disabled
              onPress={run(buyServer)}
            />
          </>
        )}
      </ServerCard>
      {offer === null ? null : (
        <Text textRole="label" className="text-center text-foreground-muted">
          {SOLD_ON_WEB ? MAJORDOME_SERVER_ON_WEB.renews : MAJORDOME_SERVER.renews}
        </Text>
      )}
      <View className="flex-row flex-wrap justify-center">
        {isSignedIn && offer !== null && !SOLD_ON_WEB ? (
          <Button
            label={MAJORDOME_SERVER.restore}
            tone="text"
            size="compact"
            onPress={run(restoreServer)}
          />
        ) : null}
        {offer === null ? null : (
          <Button
            label={MAJORDOME_SERVER.manage}
            tone="text"
            size="compact"
            onPress={manageSubscription}
          />
        )}
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

  // A server that needed no setup has nothing left to say here: it shows on the list of servers.
  // Pressing Done after a setup also ends on "done", but has left this page by then.
  const connected = state.step === "done";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the connection ends outside React, whichever action started it, and the navigator is what has to follow
  useEffect(() => {
    if (!connected || !navigation.isFocused()) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    openSettings(navigation, "SettingsEnvironments");
  }, [connected, navigation]);

  // Signing in ends this by itself: the offer is back the moment the account is.
  if (signingIn && !isSignedIn) {
    return (
      <View collapsable={false} className="flex-1 overflow-hidden bg-sheet">
        <AuthView isDismissible={false} />
      </View>
    );
  }

  return (
    <SettingsScreen title={MAJORDOME_SERVER.title}>
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
        ) : state.step === "paying" ? (
          <Progress
            text={
              SOLD_ON_WEB && state.doing === "buying"
                ? MAJORDOME_SERVER_ON_WEB.buying
                : MAJORDOME_SERVER[state.doing]
            }
          />
        ) : state.step === "making" ? (
          <Progress text={MAJORDOME_SERVER.making} />
        ) : state.step === "waiting" || state.step === "pairing" || state.step === "done" ? (
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
