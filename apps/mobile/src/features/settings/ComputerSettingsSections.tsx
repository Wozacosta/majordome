import {
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useMessages } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import {
  MAJORDOME_COMPUTER_SETTINGS,
  MAJORDOME_COMPUTER_SWITCHES,
} from "../../majordome/settingsRows";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import {
  RUNTIME_MODE_CHOICES,
  withManagedRuntimeModeLimits,
} from "../threads/thread-settings-options";
import { AutoSettleDaysField } from "./components/AutoSettleDaysField";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import type { SettingsTarget } from "./settings-environment-filter";
import { managedSettingReason, resolveMobileSettingsTargets } from "./settings-scoped-server";
import { useSettingsWriter } from "./useSettingsWriter";

const QUIET_DAYS_DEFAULT = DEFAULT_SERVER_SETTINGS.sidebarAutoSettleAfterDays ?? 7;

/**
 * How Majordome works on one computer: how much the assistant does without asking, and what it
 * does by itself. Each row saves to this computer alone. Nothing while it cannot be reached,
 * since the settings are read from it.
 */
export function ComputerSettingsSections(props: { readonly environmentId: EnvironmentId }) {
  const { environments } = useEnvironments();
  const environment = environments.find(
    (entry): entry is SettingsTarget =>
      entry.environmentId === props.environmentId &&
      entry.connection.phase === "connected" &&
      entry.serverConfig !== null,
  );
  return environment === undefined ? null : <ConnectedComputerSettings environment={environment} />;
}

function ConnectedComputerSettings({ environment }: { readonly environment: SettingsTarget }) {
  const m = useMessages();
  const canWrite = useEnvironmentScope(environment.environmentId, AuthSettingsWriteScope);
  const writeSettings = useSettingsWriter();
  const [saving, setSaving] = useState(false);
  const targets = resolveMobileSettingsTargets([environment], null);
  const settings = environment.serverConfig.settings;
  const disabledFor = (key: string) =>
    !canWrite || saving || managedSettingReason(targets, [key], m) !== undefined;
  const save = (patch: Parameters<typeof writeSettings>[1][number]["patch"]) => {
    if (!canWrite || saving) return;
    setSaving(true);
    void writeSettings(targets, [{ environmentId: environment.environmentId, patch }]).finally(() =>
      setSaving(false),
    );
  };
  const levels = withManagedRuntimeModeLimits(
    RUNTIME_MODE_CHOICES,
    [environment.serverConfig.managedPolicy],
    m,
  );
  const quietDays = settings.sidebarAutoSettleAfterDays;
  return (
    <>
      <SettingsSection
        title={MAJORDOME_COMPUTER_SETTINGS.carefulness}
        footer={managedSettingReason(targets, ["defaultRuntimeMode"], m)}
      >
        {levels.map((level, index) => (
          <ListChoiceRow
            key={level.mode}
            label={m(level.label)}
            description={level.disabledReason ?? m(level.description)}
            selected={settings.defaultRuntimeMode === level.mode}
            separated={index > 0}
            disabled={disabledFor("defaultRuntimeMode") || level.disabledReason !== undefined}
            onPress={() => save({ defaultRuntimeMode: level.mode })}
          />
        ))}
      </SettingsSection>
      <SettingsSection>
        {MAJORDOME_COMPUTER_SWITCHES.map((entry) => (
          <SettingsSwitchRow
            key={entry.key}
            icon={entry.icon}
            label={entry.label}
            subtitle={managedSettingReason(targets, [entry.key], m)}
            value={settings[entry.key]}
            disabled={disabledFor(entry.key)}
            onValueChange={(value) => save({ [entry.key]: value })}
          />
        ))}
        <SettingsSwitchRow
          icon="checkmark.circle"
          label={MAJORDOME_COMPUTER_SETTINGS.quietChats}
          value={quietDays !== null}
          disabled={disabledFor("sidebarAutoSettleAfterDays")}
          onValueChange={(value) =>
            save({ sidebarAutoSettleAfterDays: value ? QUIET_DAYS_DEFAULT : null })
          }
        />
        {quietDays === null ? null : (
          <View className="flex-row items-center gap-4 px-4 py-4 android:min-h-14 android:py-3">
            <View className="w-[22px] android:w-6" />
            <Text className="flex-1 text-foreground text-lg android:text-base">
              {MAJORDOME_COMPUTER_SETTINGS.quietDays}
            </Text>
            <AutoSettleDaysField
              value={quietDays}
              disabled={disabledFor("sidebarAutoSettleAfterDays")}
              onValueChange={(value) => save({ sidebarAutoSettleAfterDays: value })}
            />
            <Text className="text-foreground text-lg android:text-base">
              {MAJORDOME_COMPUTER_SETTINGS.quietDaysUnit(quietDays)}
            </Text>
          </View>
        )}
      </SettingsSection>
    </>
  );
}
