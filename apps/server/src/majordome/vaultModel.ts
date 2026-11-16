/** The model Majordome starts a vault's threads with when nobody picks one. */

import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

/**
 * The project's default model, else the model of its latest thread, else the first ready provider's
 * default, as on a fresh server; null when no provider is ready.
 */
export const chooseVaultModel = Effect.fn("majordome.chooseVaultModel")(
  function* (project: ProjectStore.ProjectRow) {
    const settings = yield* ServerSettings.ServerSettingsService;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const configured = resolveProjectSettings(
      yield* settings.getSettings,
      project.projectId,
      project,
    ).settings.defaultModelSelection;
    if (configured !== null) return configured;
    const latest = (yield* threads.listProjectThreads({
      projectId: project.projectId,
      includeSubagents: false,
    })).toSorted(
      (a, b) => DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt),
    )[0];
    const fromThread =
      latest === undefined ? null : (yield* threads.getThreadShell(latest.id))?.modelSelection;
    return fromThread ?? firstReadyProviderModel(yield* providers.getProviders);
  },
  Effect.orElseSucceed((): ModelSelection | null => null),
);

export function isProviderReady(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    provider.installed &&
    provider.status === "ready" &&
    provider.availability !== "unavailable"
  );
}

/** The default model of the first provider that is set up and ready, as a new chat would pick. */
function firstReadyProviderModel(providers: ReadonlyArray<ServerProvider>): ModelSelection | null {
  for (const provider of providers) {
    if (!isProviderReady(provider)) continue;
    const model =
      provider.models.find((candidate) => candidate.isDefault === true && !candidate.isCustom) ??
      provider.models.find((candidate) => !candidate.isCustom) ??
      provider.models[0];
    if (model !== undefined) return { instanceId: provider.instanceId, model: model.slug };
  }
  return null;
}
