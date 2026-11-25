import {
  PROVIDER_DISPLAY_NAMES,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { isProviderReady, type ModelLevel } from "@t3tools/shared/majordomeModelLevels";

export interface LevelModelGroup {
  readonly instanceId: ProviderInstanceId;
  readonly accountName: string;
  readonly models: ReadonlyArray<{ readonly key: string; readonly name: string }>;
}

export const levelModelKey = (selection: ModelSelection): string =>
  `${selection.instanceId}\n${selection.model}`;

export function parseLevelModelKey(key: string): ModelSelection | null {
  const [instanceId, model] = key.split("\n");
  return instanceId && model ? { instanceId: ProviderInstanceId.make(instanceId), model } : null;
}

/**
 * The models a level can be given in Settings: the current ones of every ready AI account, and
 * the level's present model even if it is an older one. Quick leaves out what cannot do small jobs.
 */
export function levelModelGroups(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly level: ModelLevel;
  readonly current: ModelSelection | null;
}): ReadonlyArray<LevelModelGroup> {
  return input.providers.filter(isProviderReady).flatMap((provider) => {
    const isCurrent = (slug: string) =>
      input.current?.instanceId === provider.instanceId && input.current.model === slug;
    const models = provider.models.filter(
      (model) =>
        isCurrent(model.slug) ||
        (model.isLegacy !== true &&
          (input.level !== "quick" || model.supportsTextGeneration !== false)),
    );
    return models.length === 0
      ? []
      : [
          {
            instanceId: provider.instanceId,
            accountName:
              provider.displayName ?? PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver,
            models: models.map((model) => ({
              key: levelModelKey({ instanceId: provider.instanceId, model: model.slug }),
              name: model.name,
            })),
          },
        ];
  });
}
