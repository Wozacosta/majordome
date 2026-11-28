import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { SettingsSection } from "../features/settings/components/SettingsSection";
import { SettingsSwitchRow } from "../features/settings/components/SettingsSwitchRow";
import {
  appCanReceivePhonePush,
  phonePushStoreAtom,
  sendPhonePushTest,
  turnOffPhonePush,
  turnOnPhonePush,
  usePhonePushStanding,
} from "./phonePush";
import {
  EMPTY_PHONE_PUSH_STORE,
  PHONE_PUSH_WORDS,
  type PhonePushStanding,
} from "./phonePush.logic";

/** One switch, where it stands in plain words, and a test. */
export function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const standing = usePhonePushStanding();
  const wanted = (useAtomValue(phonePushStoreAtom) ?? EMPTY_PHONE_PUSH_STORE).wanted;
  const [busy, setBusy] = useState(false);
  // The phone refused when asked just now: the switch is still off, and Settings is the way.
  const [refused, setRefused] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testProblem, setTestProblem] = useState<string | null>(null);

  const shown: PhonePushStanding | null = refused && standing === "off" ? "denied" : standing;
  const buildCanReceive = appCanReceivePhonePush();

  const onSwitch = async (on: boolean) => {
    setBusy(true);
    setTestProblem(null);
    if (on) setRefused((await turnOnPhonePush()) !== "granted");
    else {
      setRefused(false);
      await turnOffPhonePush();
    }
    setBusy(false);
  };

  const onTest = async () => {
    setTesting(true);
    setTestProblem(await sendPhonePushTest());
    setTesting(false);
  };

  return (
    <SettingsScreen title={PHONE_PUSH_WORDS.title}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection>
          <SettingsSwitchRow
            icon="bell.badge"
            label={PHONE_PUSH_WORDS.switch}
            subtitle={shown === null ? undefined : PHONE_PUSH_WORDS.standing[shown]}
            value={wanted && buildCanReceive}
            disabled={busy || shown === null || !buildCanReceive}
            onValueChange={(on) => void onSwitch(on)}
          />
        </SettingsSection>
        {shown === "denied" ? (
          <Button
            label={PHONE_PUSH_WORDS.openSettings}
            onPress={() => void Linking.openSettings()}
          />
        ) : null}
        {shown === "on" ? (
          <View className="gap-2">
            <Button
              label={PHONE_PUSH_WORDS.test}
              loading={testing}
              disabled={testing}
              onPress={() => void onTest()}
            />
            {testProblem === null ? null : (
              <Text accessibilityRole="alert" className="text-danger-foreground">
                {testProblem}
              </Text>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SettingsScreen>
  );
}
