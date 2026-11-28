import { StackActions, useNavigation } from "@react-navigation/native";
import { Share } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { MAJORDOME_USE_COMPUTER } from "./connectWording";
import { Step } from "./Step";

/** For someone with no Majordome anywhere: get it on the computer, then scan its code. */
export function UseComputerScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [open, download, code] = MAJORDOME_USE_COMPUTER.steps;
  return (
    <SettingsScreen title={MAJORDOME_USE_COMPUTER.title}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-7 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <Step number={1} text={open}>
          <Text selectable textRole="largeTitle" className="font-t3-bold text-foreground">
            {MAJORDOME_USE_COMPUTER.site}
          </Text>
          <Button
            label={MAJORDOME_USE_COMPUTER.send}
            icon="square.and.arrow.up"
            onPress={() => void Share.share({ message: MAJORDOME_USE_COMPUTER.url })}
          />
        </Step>
        <Step number={2} text={download} />
        <Step number={3} text={code}>
          <Button
            label={MAJORDOME_USE_COMPUTER.scan}
            tone="primary"
            icon="qrcode.viewfinder"
            onPress={() => navigation.dispatch(StackActions.replace("SettingsEnvironmentNew"))}
          />
        </Step>
      </ScrollView>
    </SettingsScreen>
  );
}
