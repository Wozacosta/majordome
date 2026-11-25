import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  MODEL_LEVELS,
  MODEL_LEVEL_SETTING,
  MODEL_LEVEL_WORDS,
  resolveModelLevels,
  type ModelLevel,
} from "@t3tools/shared/majordomeModelLevels";

import { useAtomValue } from "@effect/atom-react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { environmentServerConfigsAtom } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { SettingsGroup } from "../settings/SettingsGroup";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { levelModelGroups, levelModelKey, parseLevelModelKey } from "./modelLevels.logic";

/** Settings, AI accounts: which model each of Majordome's three levels means on this server. */
export function ModelLevelsSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const settings = useEnvironmentSettings(props.environmentId);
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const table = useAtomValue(environmentServerConfigsAtom).get(
    props.environmentId,
  )?.modelLevelTable;
  const levels = resolveModelLevels({ providers: props.providers, settings, table });
  // No AI account is ready, so there is no model to offer yet.
  if (levels.everyday === null) return null;

  const row = (level: ModelLevel) => {
    const current = levels[level];
    const groups = levelModelGroups({ providers: props.providers, level, current });
    const names = new Map(
      groups.flatMap((group) => group.models.map((model) => [model.key, model.name] as const)),
    );
    return (
      <SettingsRow
        key={level}
        title={MODEL_LEVEL_WORDS[level].name}
        description={MODEL_LEVEL_WORDS[level].usedFor}
        control={
          <Select
            value={current === null ? null : levelModelKey(current)}
            disabled={!canWrite}
            onValueChange={(value: string | null) => {
              const selection = value === null ? null : parseLevelModelKey(value);
              if (selection) updateSettings({ [MODEL_LEVEL_SETTING[level]]: selection });
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={`${MODEL_LEVEL_WORDS[level].name} model`}
              data-majordome-level-model={level}
            >
              <SelectValue>
                {(value: string | null) =>
                  value === null ? "Choose a model" : (names.get(value) ?? current?.model)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {groups.map((group) => (
                <SelectGroup key={group.instanceId}>
                  {groups.length > 1 ? (
                    <SelectGroupLabel>{group.accountName}</SelectGroupLabel>
                  ) : null}
                  {group.models.map((model) => (
                    <SelectItem key={model.key} value={model.key}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    );
  };

  return (
    <SettingsSection title="Levels of AI">
      <SettingsGroup>
        <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">
          Majordome uses three levels of AI. Choose the model for each. In a chat, you pick the
          level from the message box.
        </p>
        {MODEL_LEVELS.map(row)}
      </SettingsGroup>
    </SettingsSection>
  );
}
