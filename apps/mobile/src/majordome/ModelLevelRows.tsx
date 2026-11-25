import {
  MODEL_LEVEL_WORDS,
  chatLevelChoices,
  type ModelLevelAccount,
  type ModelLevelSettings,
} from "@t3tools/shared/majordomeModelLevels";
import type { ModelLevelTable, ModelSelection } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../components/ui/AppText";
import { ChoiceRow } from "../features/threads/ThreadSettingsRows";
import type { ModelOption } from "../lib/modelOptions";

/**
 * The top of "Which AI": the three levels of the chat's AI account, each naming its model. The
 * full list stays below it. Nothing is drawn when the account has one model to offer.
 */
export function ModelLevelRows(props: {
  readonly account: ModelLevelAccount | null;
  readonly settings: ModelLevelSettings;
  /** The server's table of level defaults; older servers send none. */
  readonly table: ModelLevelTable | undefined;
  readonly options: ReadonlyArray<ModelOption>;
  /** The model the sheet shows as chosen, which may not be applied yet. */
  readonly selected: ModelSelection | null;
  readonly onPress: (option: ModelOption) => void;
}) {
  const account = props.account;
  if (account === null) return null;
  const rows = chatLevelChoices({
    account,
    settings: props.settings,
    model: null,
    table: props.table,
  }).choices.flatMap((choice) => {
    const option = props.options.find(
      (candidate) =>
        candidate.selection.instanceId === account.instanceId &&
        candidate.selection.model === choice.model &&
        candidate.isUnavailable !== true &&
        candidate.isHidden !== true,
    );
    return option === undefined ? [] : [{ ...choice, option }];
  });
  if (rows.length < 2) return null;
  return (
    <View>
      <Text className="px-5 pb-2 pt-2 text-sm font-t3-medium text-foreground-muted">
        How much AI this chat uses
      </Text>
      <View className="mx-4 overflow-hidden rounded-2xl bg-grouped-card">
        {rows.map((row, index) => (
          <ChoiceRow
            key={row.level}
            label={MODEL_LEVEL_WORDS[row.level].name}
            description={`${row.modelName}. ${MODEL_LEVEL_WORDS[row.level].inChat}`}
            isLast={index === rows.length - 1}
            selected={
              props.selected?.instanceId === row.option.selection.instanceId &&
              props.selected.model === row.option.selection.model
            }
            onPress={() => props.onPress(row.option)}
          />
        ))}
      </View>
      <Text className="px-5 pt-5 text-sm font-t3-medium text-foreground-muted">All models</Text>
    </View>
  );
}
