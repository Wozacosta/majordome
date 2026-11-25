/** The model Majordome starts a vault's threads with when nobody picks one. */

import type { ModelSelection } from "@t3tools/contracts";
import { resolveModelLevels } from "@t3tools/shared/majordomeModelLevels";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Effect from "effect/Effect";

import type * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { currentModelLevelTable } from "./modelLevelTable.ts";

export { isProviderReady } from "@t3tools/shared/majordomeModelLevels";

/**
 * The Everyday model: the one chosen for the vault or the server while its AI account is ready,
 * else the everyday model of the first ready account; null when no account is ready.
 */
export const chooseVaultModel = Effect.fn("majordome.chooseVaultModel")(
  function* (project: ProjectStore.ProjectRow) {
    const settings = yield* ServerSettings.ServerSettingsService;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    return resolveModelLevels({
      providers: yield* providers.getProviders,
      settings: resolveProjectSettings(yield* settings.getSettings, project.projectId, project)
        .settings,
      table: currentModelLevelTable(),
    }).everyday;
  },
  Effect.orElseSucceed((): ModelSelection | null => null),
);
