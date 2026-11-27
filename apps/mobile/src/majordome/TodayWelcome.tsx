import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  NAME_CARD,
  WELCOME_SHEET_TITLE,
  WELCOME_CONTINUE_LABEL,
  WELCOME_NAME_PLACEHOLDER,
  WELCOME_NOT_NOW_LABEL,
} from "@t3tools/shared/majordomeWelcome";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { useAtomCommand } from "../state/use-atom-command";
import { majordomeEnvironment } from "./state";

/**
 * The welcome of a new notes folder on the phone: a sheet over Today that asks what to call its
 * owner. Answered or put off, it is gone for good, on every device that opens the folder.
 */
export function TodayWelcome(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const { environmentId, projectId } = props;
  const insets = useSafeAreaInsets();
  const finish = useAtomCommand(majordomeEnvironment.finishWelcome, { reportFailure: false });
  const [name, setName] = useState("");
  const [left, setLeft] = useState(false);
  const end = (given: string | null) => {
    setLeft(true);
    void finish({ environmentId, input: { projectId, name: given } });
  };
  const answer = () => end(name.trim() === "" ? null : name);

  return (
    <Modal
      visible={!left}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={() => end(null)}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-end bg-black/50"
      >
        <View
          accessibilityViewIsModal
          accessibilityLabel="Welcome"
          className="gap-4 rounded-t-3xl border-t border-border bg-screen px-5 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 18) + 6 }}
        >
          <View className="h-1 w-9 self-center rounded-full bg-border" />
          <View className="gap-1">
            <Text accessibilityRole="header" textRole="title" className="font-t3-bold">
              {WELCOME_SHEET_TITLE}
            </Text>
            <Text className="text-foreground-secondary">{NAME_CARD.body}</Text>
          </View>
          <TextInput
            autoFocus
            accessibilityLabel={WELCOME_SHEET_TITLE}
            placeholder={WELCOME_NAME_PLACEHOLDER}
            autoCapitalize="words"
            autoComplete="given-name"
            textContentType="givenName"
            returnKeyType="done"
            maxLength={80}
            value={name}
            onChangeText={setName}
            onSubmitEditing={answer}
          />
          <View className="gap-1">
            <Button label={WELCOME_CONTINUE_LABEL} tone="primary" fullWidth onPress={answer} />
            <Button label={WELCOME_NOT_NOW_LABEL} tone="text" fullWidth onPress={() => end(null)} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
