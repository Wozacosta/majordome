import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  chatLevelChoices,
  defaultLevelModel,
  levelOfModel,
  modelLevelsForProvider,
  resolveModelLevels,
  type ModelLevelSettings,
} from "./majordomeModelLevels.ts";

function provider(
  driver: string,
  slugs: ReadonlyArray<string>,
  overrides: Partial<ServerProvider> = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-25T11:00:00.000Z",
    models: slugs.map((slug, index) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: null,
      ...(index === 0 ? { isDefault: true } : {}),
      ...(slug.endsWith("-old") ? { isLegacy: true } : {}),
    })),
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

const claude = provider("claudeAgent", [
  "claude-fable-5-2",
  "claude-opus-4-8-old",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
]);
const codex = provider("codex", ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]);

const untouched: ModelLevelSettings = {
  textGenerationModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "x" },
  defaultModelSelection: null,
  powerfulModelSelection: null,
};

const levels = (target: ServerProvider) => ({
  quick: defaultLevelModel(target, "quick"),
  everyday: defaultLevelModel(target, "everyday"),
  powerful: defaultLevelModel(target, "powerful"),
});

it("gives each kind of AI account its own three models", () => {
  expect(levels(claude)).toEqual({
    quick: "claude-haiku-5-5",
    everyday: "claude-sonnet-5-5",
    powerful: "claude-opus-5-5",
  });
  expect(levels(codex)).toEqual({
    quick: "gpt-6-luna",
    everyday: "gpt-6.1-sol",
    powerful: "gpt-6-astra",
  });
  expect(
    levels(provider("antigravity", ["gemini-4-carbon", "gemini-4-argon", "gemini-3.8-flash"])),
  ).toEqual({ quick: "gemini-3.8-flash", everyday: "gemini-4-argon", powerful: "gemini-4-carbon" });
  // An account that resells other makers' models is read by family.
  expect(
    levels(
      provider("opencode", [
        "openai/gpt-5",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-opus-5",
      ]),
    ),
  ).toEqual({
    quick: "openai/gpt-5",
    everyday: "anthropic/claude-sonnet-5",
    powerful: "anthropic/claude-opus-5",
  });
});

it("falls back to the account's own model when it has no such family", () => {
  expect(levels(provider("grok", ["grok-build"]))).toEqual({
    quick: "grok-build",
    everyday: "grok-build",
    powerful: "grok-build",
  });
  expect(defaultLevelModel(provider("pi", []), "everyday")).toBeNull();
});

it("leaves a model that cannot do small jobs out of Quick", () => {
  const target = provider("claudeAgent", ["claude-haiku-5-5", "claude-sonnet-5-5"]);
  const noSmallJobs = {
    ...target,
    models: target.models.map((model) =>
      model.slug === "claude-haiku-5-5" ? { ...model, supportsTextGeneration: false } : model,
    ),
  };
  expect(defaultLevelModel(noSmallJobs, "quick")).toBe("claude-sonnet-5-5");
});

it("uses the owner's choice for a level, on the account it names", () => {
  const settings: ModelLevelSettings = {
    ...untouched,
    powerfulModelSelection: { instanceId: claude.instanceId, model: "claude-fable-5-2" },
  };
  expect(modelLevelsForProvider(claude, settings).powerful).toBe("claude-fable-5-2");
  expect(modelLevelsForProvider(codex, settings).powerful).toBe("gpt-6-astra");
});

it("resolves the server's levels on the account Everyday uses, else the first ready one", () => {
  const signedOut = { ...codex, status: "error" as const };
  expect(resolveModelLevels({ providers: [signedOut, claude], settings: untouched })).toEqual({
    quick: { instanceId: claude.instanceId, model: "claude-haiku-5-5" },
    everyday: { instanceId: claude.instanceId, model: "claude-sonnet-5-5" },
    powerful: { instanceId: claude.instanceId, model: "claude-opus-5-5" },
  });
  expect(
    resolveModelLevels({
      providers: [codex, claude],
      settings: {
        ...untouched,
        defaultModelSelection: { instanceId: claude.instanceId, model: "claude-opus-5-5" },
      },
    }),
  ).toEqual({
    quick: untouched.textGenerationModelSelection,
    everyday: { instanceId: claude.instanceId, model: "claude-opus-5-5" },
    powerful: { instanceId: claude.instanceId, model: "claude-opus-5-5" },
  });
  expect(resolveModelLevels({ providers: [signedOut], settings: untouched }).everyday).toBeNull();
  // A choice whose account is not ready stays while no other account is.
  const chosen = { instanceId: codex.instanceId, model: "gpt-6-astra" };
  expect(
    resolveModelLevels({
      providers: [signedOut],
      settings: { ...untouched, defaultModelSelection: chosen },
    }).everyday,
  ).toEqual(chosen);
});

it("names the level a chat is on", () => {
  const chat = modelLevelsForProvider(claude, untouched);
  expect(levelOfModel(chat, "claude-opus-5-5")).toBe("powerful");
  expect(levelOfModel(chat, "claude-fable-5-2")).toBeNull();
  expect(levelOfModel({ ...chat, powerful: chat.everyday }, chat.everyday)).toBe("everyday");
});

it("offers a chat the levels of its AI account, each model once", () => {
  const result = chatLevelChoices({
    account: claude,
    settings: untouched,
    model: "claude-opus-5-5",
  });
  expect(result.choices.map((choice) => [choice.level, choice.model])).toEqual([
    ["quick", "claude-haiku-5-5"],
    ["everyday", "claude-sonnet-5-5"],
    ["powerful", "claude-opus-5-5"],
  ]);
  expect(result.current).toBe("powerful");
  const grok = provider("grok", ["grok-build", "grok-other"]);
  const single = chatLevelChoices({ account: grok, settings: untouched, model: "grok-other" });
  expect(single.choices.map((choice) => choice.level)).toEqual(["everyday"]);
  expect(single.current).toBeNull();
  expect(single.currentName).toBe("grok-other");
});
