import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  MAJORDOME_SAVED_KEY_NOTE_MAX,
  type MajordomeSavedKey,
} from "@t3tools/contracts";
import { savedKeyLine, savedKeyNameFrom } from "@t3tools/shared/majordomeSavedKeys";
import type * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import * as Dialog from "../components/ui/Dialog";
import { ListActionRow } from "../components/ui/ListActionRow";
import { ListSection } from "../components/ui/ListSection";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { SecretTextInput } from "../components/ui/SecretTextInput";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { useSettingsEnvironmentFilter } from "../features/settings/settings-environment-filter";
import { useAtomCommand } from "../state/use-atom-command";
import { MAJORDOME_SETTINGS_LABELS } from "./settingsRows";
import { majordomeEnvironment } from "./state";

const failureMessage = (result: { readonly cause: Cause.Cause<unknown> }, fallback: string) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message !== "" ? error.message : fallback;
};

/**
 * The keys, tokens and passwords saved for the assistant on each computer this phone talks to.
 * The owner adds and removes them here; a value is never shown again once saved.
 */
export function SavedKeysScreen() {
  const insets = useSafeAreaInsets();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <SettingsScreen title={MAJORDOME_SETTINGS_LABELS.SettingsSavedKeys}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        // So the Save button can be scrolled above the keyboard.
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-2"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <Text className="text-foreground-muted">
          What your assistant can use without asking you for it each time: an API key, a token, a
          password. It sees each name and what it is for, never the key in the chat.
        </Text>
        {selectedTargets.length === 0 ? (
          <Text className="text-foreground-muted">
            Your computer can't be reached right now, so its keys can't be shown.
          </Text>
        ) : (
          selectedTargets.map((target) => (
            <ComputerKeys
              key={target.environmentId}
              environmentId={target.environmentId}
              title={selectedTargets.length > 1 ? target.label : undefined}
            />
          ))
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

function ComputerKeys({
  environmentId,
  title,
}: {
  readonly environmentId: EnvironmentId;
  readonly title: string | undefined;
}) {
  const result = useAtomValue(majordomeEnvironment.savedKeys({ environmentId, input: {} }));
  const canChange = useAtomValue(majordomeEnvironment.saveKey.permissionAtom(environmentId));
  const removeSavedKey = useAtomCommand(majordomeEnvironment.removeSavedKey, {
    reportFailure: false,
    reportDefect: false,
  });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const data = AsyncResult.getOrElse(result, () => null);
  if (data === null) {
    // A computer from before saved keys answers with a failure: say so rather than show nothing.
    return (
      <ListSection {...(title === undefined ? {} : { title })}>
        <Text className="px-4 py-3 text-foreground-muted">
          {result._tag === "Failure"
            ? "This computer's keys couldn't be read. It may need a newer Majordome."
            : "Reading…"}
        </Text>
      </ListSection>
    );
  }

  const remove = (key: MajordomeSavedKey) =>
    Dialog.confirm({
      title: `Remove “${key.name}”?`,
      message:
        "Your assistant can no longer use this key, and Majordome deletes its copy if it holds one. The key itself still works wherever it came from: cancel it there if it should stop working.",
      confirmText: "Remove",
      destructive: true,
      onConfirm: () => {
        setRemoving(key.name);
        void removeSavedKey({ environmentId, input: { name: key.name } }).then((removed) => {
          setRemoving(null);
          if (removed._tag === "Failure" && !isAtomCommandInterrupted(removed)) {
            Dialog.alert("Could not remove it", failureMessage(removed, "Try again."));
          }
        });
      },
    });

  // The form takes the list's place: with the keyboard up, its Save button must stay in view.
  if (adding && canChange) {
    return (
      <AddKeyForm
        environmentId={environmentId}
        taken={data.keys.map((key) => key.name)}
        onClose={() => setAdding(false)}
      />
    );
  }
  return (
    <View className="gap-3">
      <ListSection
        {...(title === undefined ? {} : { title })}
        {...(canChange && data.keys.length > 0 ? { footer: "Touch a key to remove it." } : {})}
      >
        {data.keys.length === 0 ? (
          <Text className="px-4 py-3 text-foreground-muted">No keys saved yet.</Text>
        ) : (
          data.keys.map((key) => (
            <ListActionRow
              key={key.name}
              icon="key"
              label={key.name}
              description={savedKeyLine(key)}
              loading={removing === key.name}
              disabled={!canChange}
              onPress={() => remove(key)}
            />
          ))
        )}
      </ListSection>
      {canChange ? <Button label="Add a key" icon="plus" onPress={() => setAdding(true)} /> : null}
    </View>
  );
}

function AddKeyForm({
  environmentId,
  taken,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly taken: ReadonlyArray<string>;
  readonly onClose: () => void;
}) {
  const saveKey = useAtomCommand(majordomeEnvironment.saveKey, {
    reportFailure: false,
    reportDefect: false,
  });
  const [typedName, setTypedName] = useState("");
  const [note, setNote] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = savedKeyNameFrom(typedName);
  const replaces = taken.includes(name);

  const submit = async (typedValue: string) => {
    if (busy) return;
    if (name === "") return setError("Give the key a name, such as garmin.");
    if (typedValue === "") return setError("Paste the key.");
    setBusy(true);
    setError(null);
    const saved = await saveKey({
      environmentId,
      input: { name, value: typedValue, ...(note.trim() === "" ? {} : { note: note.trim() }) },
    });
    setBusy(false);
    if (saved._tag === "Success") onClose();
    else if (saved._tag === "Failure" && !isAtomCommandInterrupted(saved)) {
      setError(failureMessage(saved, "The key could not be saved. Try again."));
    }
  };

  return (
    <View className="gap-3 rounded-[26px] border-continuous bg-grouped-card p-4">
      <Text textRole="footnote" className="font-t3-medium text-foreground-muted">
        Name
      </Text>
      <TextInput
        accessibilityLabel="Name"
        placeholder="garmin"
        autoCapitalize="none"
        autoCorrect={false}
        // Not a sign-in form: keeps iOS from offering to save the key as a password.
        textContentType="none"
        editable={!busy}
        value={typedName}
        onChangeText={(text) => {
          setTypedName(text);
          setError(null);
        }}
      />
      {name !== "" && name !== typedName ? (
        <Text textRole="footnote" className="text-foreground-muted">
          Saved as {name}.
        </Text>
      ) : null}
      <Text textRole="footnote" className="font-t3-medium text-foreground-muted">
        What it is for (optional)
      </Text>
      <TextInput
        accessibilityLabel="What it is for"
        placeholder="Garmin Connect token, to read my runs"
        maxLength={MAJORDOME_SAVED_KEY_NOTE_MAX}
        editable={!busy}
        value={note}
        onChangeText={setNote}
      />
      <Text textRole="footnote" className="font-t3-medium text-foreground-muted">
        The key
      </Text>
      <SecretTextInput
        accessibilityLabel="The key"
        placeholder="Paste it here"
        editable={!busy}
        value={value}
        onChangeText={(text) => {
          setValue(text);
          setError(null);
        }}
        onSubmitEditing={(text) => void submit(text)}
      />
      {replaces ? (
        <Text textRole="footnote" className="text-foreground-muted">
          A key named {name} is already saved. Saving replaces it.
        </Text>
      ) : null}
      {error === null ? null : (
        <Text accessibilityRole="alert" className="text-danger-foreground">
          {error}
        </Text>
      )}
      <View className="flex-row flex-wrap items-center gap-2">
        <Button
          label={replaces ? "Replace key" : "Save key"}
          tone="primary"
          loading={busy}
          onPress={() => void submit(value)}
        />
        <Button label="Cancel" tone="text" disabled={busy} onPress={onClose} />
      </View>
    </View>
  );
}
