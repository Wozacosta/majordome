/**
 * Majordome asks its owner for a level, not a model: Quick, Everyday or Powerful. Which model a
 * level means depends on the AI account behind it, and the owner can change it.
 */

import {
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ModelSelection,
  type ServerProvider,
  type ServerProviderModel,
  type ServerSettings,
} from "@t3tools/contracts";

export const MODEL_LEVELS = ["quick", "everyday", "powerful"] as const;
export type ModelLevel = (typeof MODEL_LEVELS)[number];

export const MODEL_LEVEL_WORDS: Record<
  ModelLevel,
  { readonly name: string; readonly usedFor: string; readonly inChat: string }
> = {
  quick: {
    name: "Quick",
    usedFor: "Small jobs done for you: chat titles, key facts, summaries and drawings.",
    inChat: "Fast and light, for simple questions.",
  },
  everyday: {
    name: "Everyday",
    usedFor: "Your chats and routines. New chats start here.",
    inChat: "Right for most things.",
  },
  powerful: {
    name: "Powerful",
    usedFor: "Hard questions, when you choose it in a chat.",
    inChat: "For hard questions. Slower, and uses more of your plan.",
  },
};

/** Where each level's model is kept. Quick and Everyday are settings T3 Code already reads. */
export const MODEL_LEVEL_SETTING = {
  quick: "textGenerationModelSelection",
  everyday: "defaultModelSelection",
  powerful: "powerfulModelSelection",
} as const satisfies Record<ModelLevel, keyof ServerSettings>;

export type ModelLevelSettings = Pick<ServerSettings, (typeof MODEL_LEVEL_SETTING)[ModelLevel]>;

/** What a level is worked out from: one AI account and the models it lists. */
export type ModelLevelAccount = Pick<ServerProvider, "driver" | "instanceId" | "models">;

type LevelFamilies = Record<ModelLevel, ReadonlyArray<string>>;

/**
 * A level's model families per kind of AI account, best first. A family is a piece of the model's
 * id, so a newer version of the same family is picked up without a change here.
 */
const DRIVER_LEVEL_FAMILIES: Readonly<Record<string, LevelFamilies>> = {
  claudeAgent: { quick: ["haiku"], everyday: ["sonnet"], powerful: ["opus"] },
  codex: { quick: ["luna", "mini"], everyday: ["sol", "terra"], powerful: ["astra"] },
  antigravity: { quick: ["flash"], everyday: ["argon"], powerful: ["carbon"] },
  cursor: { quick: ["composer"], everyday: ["auto"], powerful: [] },
};

/** Accounts that resell other makers' models (OpenCode, Pi, Kiro, Cursor) list these families. */
const ANY_DRIVER_LEVEL_FAMILIES: LevelFamilies = {
  quick: ["haiku", "luna", "flash", "mini"],
  everyday: ["sonnet"],
  powerful: ["opus"],
};

export function isProviderReady(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    provider.installed &&
    provider.status === "ready" &&
    provider.availability !== "unavailable"
  );
}

function accountDefaultModel(
  models: ReadonlyArray<ServerProviderModel>,
): ServerProviderModel | undefined {
  return (
    models.find((model) => model.isDefault === true && !model.isCustom) ??
    models.find((model) => !model.isCustom) ??
    models[0]
  );
}

function familyModel(
  models: ReadonlyArray<ServerProviderModel>,
  family: string,
): ServerProviderModel | undefined {
  const matches = models.filter(
    (model) => !model.isCustom && model.slug.toLowerCase().includes(family),
  );
  return (
    matches.find((model) => model.slug.toLowerCase() === family) ??
    matches.find((model) => model.isLegacy !== true) ??
    matches[0]
  );
}

/** The model a level means on this AI account when its owner chose none; null if it lists no model. */
export function defaultLevelModel(provider: ModelLevelAccount, level: ModelLevel): string | null {
  const models =
    level === "quick"
      ? provider.models.filter((model) => model.supportsTextGeneration !== false)
      : provider.models;
  const families = [
    ...(DRIVER_LEVEL_FAMILIES[provider.driver]?.[level] ?? []),
    ...ANY_DRIVER_LEVEL_FAMILIES[level],
  ];
  for (const family of families) {
    const model = familyModel(models, family);
    if (model !== undefined) return model.slug;
  }
  const smallJobs =
    level === "quick" ? DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[provider.driver] : undefined;
  return (
    models.find((model) => model.slug === smallJobs)?.slug ??
    accountDefaultModel(models)?.slug ??
    null
  );
}

/** The three models a chat on this AI account chooses between. */
export function modelLevelsForProvider(
  provider: ModelLevelAccount,
  settings: ModelLevelSettings,
): Record<ModelLevel, string | null> {
  const model = (level: ModelLevel) => {
    const chosen = settings[MODEL_LEVEL_SETTING[level]];
    return chosen?.instanceId === provider.instanceId
      ? chosen.model
      : defaultLevelModel(provider, level);
  };
  return { quick: model("quick"), everyday: model("everyday"), powerful: model("powerful") };
}

/**
 * The model each level means on this server: the owner's choice while its AI account is ready,
 * else that level on the account Everyday uses, else on the first ready account.
 */
export function resolveModelLevels(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: ModelLevelSettings;
}): Record<ModelLevel, ModelSelection | null> {
  const ready = input.providers.filter(isProviderReady);
  const readyInstance = (selection: ModelSelection | null) =>
    selection === null
      ? undefined
      : ready.find((provider) => provider.instanceId === selection.instanceId);
  const home = readyInstance(input.settings.defaultModelSelection) ?? ready[0];
  const resolve = (level: ModelLevel): ModelSelection | null => {
    const chosen = input.settings[MODEL_LEVEL_SETTING[level]];
    // With no account ready there is nothing better to offer, and at startup none is ready yet.
    if (chosen !== null && (readyInstance(chosen) !== undefined || home === undefined)) {
      return chosen;
    }
    const model = home === undefined ? null : defaultLevelModel(home, level);
    return home === undefined || model === null ? null : { instanceId: home.instanceId, model };
  };
  return { quick: resolve("quick"), everyday: resolve("everyday"), powerful: resolve("powerful") };
}

/** The level a chat is on; null when its model is none of the three. Two levels on one model read as the everyday one first. */
export function levelOfModel(
  levels: Record<ModelLevel, string | null>,
  model: string | null | undefined,
): ModelLevel | null {
  if (model === null || model === undefined) return null;
  return (
    (["everyday", "powerful", "quick"] as const).find((level) => levels[level] === model) ?? null
  );
}

export interface ChatLevelChoice {
  readonly level: ModelLevel;
  readonly model: string;
  readonly modelName: string;
}

/**
 * The levels a chat on this AI account can move between, and the one it is on. Levels that mean
 * the same model are offered once, so an account with a single model offers nothing to choose.
 */
export function chatLevelChoices(input: {
  readonly account: ModelLevelAccount;
  readonly settings: ModelLevelSettings;
  readonly model: string | null;
}): {
  readonly choices: ReadonlyArray<ChatLevelChoice>;
  readonly current: ModelLevel | null;
  readonly currentName: string | null;
} {
  const levels = modelLevelsForProvider(input.account, input.settings);
  const nameOf = (model: string) =>
    input.account.models.find((candidate) => candidate.slug === model)?.name ?? model;
  const choices = MODEL_LEVELS.flatMap((level) => {
    const model = levels[level];
    return model === null || levelOfModel(levels, model) !== level
      ? []
      : [{ level, model, modelName: nameOf(model) }];
  });
  return {
    choices,
    current: levelOfModel(levels, input.model),
    currentName: input.model === null ? null : nameOf(input.model),
  };
}
