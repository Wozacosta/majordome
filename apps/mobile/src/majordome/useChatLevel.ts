import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { MODEL_LEVEL_WORDS, chatLevelChoices } from "@t3tools/shared/majordomeModelLevels";
import { useAtomValue } from "@effect/atom-react";

import { environmentServerConfigsAtom } from "../state/server";

/**
 * The level a chat is on, as the owner reads it ("Everyday"); null when its model is none of the
 * three, or the computer has not said what the levels mean yet.
 */
export function useChatLevelName(
  environmentId: EnvironmentId,
  selection: ModelSelection | null,
): string | null {
  const config = useAtomValue(environmentServerConfigsAtom).get(environmentId);
  if (config === undefined || selection === null) return null;
  const account = config.providers.find((provider) => provider.instanceId === selection.instanceId);
  if (account === undefined) return null;
  const { current } = chatLevelChoices({
    account,
    settings: config.settings,
    model: selection.model,
    table: config.modelLevelTable,
  });
  return current === null ? null : MODEL_LEVEL_WORDS[current].name;
}
