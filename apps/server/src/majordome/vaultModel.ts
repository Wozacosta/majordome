/** The model Majordome starts a vault's threads with when nobody picks one. */

import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";

/** The project's default model, else the model of its latest thread; null when it has neither. */
export const chooseVaultModel = Effect.fn("majordome.chooseVaultModel")(
  function* (project: ProjectStore.ProjectRow) {
    const settings = yield* ServerSettings.ServerSettingsService;
    const threads = yield* ThreadManagementService.ThreadManagementService;
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
    if (latest === undefined) return null;
    return (yield* threads.getThreadShell(latest.id))?.modelSelection ?? null;
  },
  Effect.orElseSucceed((): ModelSelection | null => null),
);

/** The default model of the first provider that is set up and ready, as a new chat would pick. */
export function firstReadyProviderModel(
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection | null {
  for (const provider of providers) {
    if (!provider.enabled || !provider.installed || provider.status !== "ready") continue;
    if (provider.availability === "unavailable") continue;
    const model =
      provider.models.find((candidate) => candidate.isDefault === true && !candidate.isCustom) ??
      provider.models.find((candidate) => !candidate.isCustom) ??
      provider.models[0];
    if (model !== undefined) return { instanceId: provider.instanceId, model: model.slug };
  }
  return null;
}
