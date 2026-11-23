import { useAtomValue } from "@effect/atom-react";

import { useRetryEnvironment } from "../features/connection/useRetryEnvironment";
import { useProjects } from "../state/entities";
import { useWorkspaceState } from "../state/workspace";
import { vaultTopicsAtom } from "./state";
import type { TodayStore } from "./today.logic";
import { computerReach, todaySetup, type ComputerReach, type TodaySetup } from "./todayView.logic";

/**
 * Whether Today has a notes folder to show and whether its computer can be reached now, from the
 * app's own connections rather than from how long a read has been out.
 */
export function useTodaySetup(
  store: TodayStore | null,
  vault: TodayStore["vault"],
): {
  readonly setup: TodaySetup;
  readonly reach: ComputerReach;
  /** Tries the computers that are not connected again. */
  readonly reconnect: () => void;
} {
  const { environments, state } = useWorkspaceState();
  const retry = useRetryEnvironment();
  // The same list and key `useVault` reads, so this adds no request of its own.
  const projects = useProjects().filter((project) => !project.archivedAt && !project.isScratch);
  const key = JSON.stringify(projects.map((project) => [project.environmentId, project.id]));
  const results = useAtomValue(vaultTopicsAtom(key));
  const phoneOffline = state.networkStatus === "offline";
  const active = environments.filter((environment) => environment.isEnabled);
  const reaches = active.map((environment) =>
    computerReach(environment.connectionState, phoneOffline),
  );
  const connected = new Set<string | undefined>(
    active
      .filter((_, index) => reaches[index] === "connected")
      .map((environment) => environment.environmentId),
  );
  const folderComputer =
    vault === null
      ? undefined
      : environments.find((environment) => environment.environmentId === vault.environmentId);

  return {
    setup: todaySetup({
      storeLoaded: store !== null,
      connections: state.isLoadingConnections ? "loading" : state.hasConnections ? "some" : "none",
      hasFolder: vault !== null,
      folderComputerKnown: folderComputer !== undefined,
      anyConnected: reaches.includes("connected"),
      anyConnecting: reaches.includes("connecting"),
      searching:
        state.hasSyncingConnectedEnvironment ||
        // A computer that is not connected never answers; only the connected ones are waited for.
        results.some(
          (result, index) =>
            (result._tag === "Initial" || result.waiting) &&
            connected.has(projects[index]?.environmentId),
        ),
    }),
    reach: computerReach(
      folderComputer?.isEnabled === false ? undefined : folderComputer?.connectionState,
      phoneOffline,
    ),
    reconnect: () => {
      // Not the ones switched off: trying those again would switch them back on.
      for (const environment of active) {
        if (environment.connectionState !== "connected") void retry(environment.environmentId);
      }
    },
  };
}
