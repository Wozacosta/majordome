import type { ScopedProjectRef } from "@t3tools/contracts";
import { resolveModelLevels } from "@t3tools/shared/majordomeModelLevels";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { isMajordome } from "../env";
import { resolveProjectDefaultProviderModelSelection } from "../providerInstances";
import { readProject } from "../state/entities";
import { readEnvironment, readEnvironmentProviders } from "../state/environments";
import { hasExplicitComposerModelSelection } from "./chatThreadActions";

/** Gives a draft that moved project or machine the model a new thread there would start with. */
export function seedDraftModelSelection(draftId: DraftId, projectRef: ScopedProjectRef): void {
  const store = useComposerDraftStore.getState();
  if (hasExplicitComposerModelSelection(store.getComposerDraft(draftId))) return;
  store.applyStickyState(draftId);
  const project = readProject(projectRef);
  const serverConfig = readEnvironment(projectRef.environmentId)?.serverConfig;
  const settings = serverConfig?.settings;
  const providers = readEnvironmentProviders(projectRef.environmentId) ?? [];
  const projectSettings = settings
    ? resolveProjectSettings(settings, projectRef.projectId, project ?? undefined).settings
    : null;
  const defaultSelection = projectSettings
    ? (projectSettings.defaultModelSelection ??
      (isMajordome
        ? resolveModelLevels({
            providers,
            settings: projectSettings,
            table: serverConfig?.modelLevelTable,
          }).everyday
        : null))
    : (project?.defaultModelSelection ?? null);
  const resolution = resolveNewThreadModelSelection({
    defaultSelection:
      defaultSelection ??
      (useComposerDraftStore.getState().stickyActiveProvider !== null || !settings
        ? null
        : resolveProjectDefaultProviderModelSelection(providers, settings, projectRef.projectId)),
    fallbackSelection: settings?.fallbackModelSelection ?? null,
    providers,
    ...(settings ? { settings } : {}),
    projectId: projectRef.projectId,
    now: Date.now(),
  });
  const selection = resolution.fallback ? resolution.selection : defaultSelection;
  if (selection) store.setModelSelection(draftId, selection, { replaceOptions: true });
}
