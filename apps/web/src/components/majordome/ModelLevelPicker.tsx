import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import {
  MODEL_LEVEL_WORDS,
  chatLevelChoices,
  type ModelLevelAccount,
} from "@t3tools/shared/majordomeModelLevels";
import { GaugeIcon } from "lucide-react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { ComposerSelectControl, type ComposerControlSize } from "../chat/ComposerControl";
import { useComposerMenuProps } from "../chat/composerEventScope";
import { Select, SelectGroup, SelectGroupLabel, SelectItem, SelectPopup } from "../ui/select";

const OTHER_MODEL = "other";

/** Majordome's model choice in the message box: a level, with the model it means on this AI account. */
export function ModelLevelPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly account: ModelLevelAccount;
  readonly model: string | null;
  readonly disabled: boolean;
  readonly size: ComposerControlSize;
  readonly onSelect: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const settings = useEnvironmentSettings(props.environmentId);
  const composerFloatingLayerProps = useComposerMenuProps();
  const { choices, current, currentName } = chatLevelChoices({
    account: props.account,
    settings,
    model: props.model,
  });
  // One model on this account and the chat is on it: nothing to choose.
  if (choices.length === 0 || (choices.length === 1 && current !== null)) return null;
  const label = current === null ? currentName : MODEL_LEVEL_WORDS[current].name;
  return (
    <Select
      modal={false}
      value={current ?? OTHER_MODEL}
      disabled={props.disabled}
      onValueChange={(value: string | null) => {
        const choice = choices.find((candidate) => candidate.level === value);
        if (choice) props.onSelect(props.account.instanceId, choice.model);
      }}
    >
      <ComposerSelectControl
        size={props.size}
        className="min-w-0 shrink"
        aria-label={`Model: ${label ?? "not chosen"}`}
        data-majordome-model-level={current ?? OTHER_MODEL}
      >
        <GaugeIcon className="size-3.5" />
        <span data-composer-control-label>{label}</span>
      </ComposerSelectControl>
      <SelectPopup
        alignItemWithTrigger={false}
        {...composerFloatingLayerProps}
        className="w-[min(20rem,calc(100vw-2rem))]"
      >
        <SelectGroup>
          <SelectGroupLabel>How much AI this chat uses</SelectGroupLabel>
          {choices.map((choice) => (
            <SelectItem key={choice.level} value={choice.level}>
              <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
                <span className="flex items-baseline gap-2">
                  <span className="font-medium">{MODEL_LEVEL_WORDS[choice.level].name}</span>
                  <span className="truncate text-muted-foreground text-xs">{choice.modelName}</span>
                </span>
                <span className="whitespace-normal text-muted-foreground text-xs">
                  {MODEL_LEVEL_WORDS[choice.level].inChat}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
}
