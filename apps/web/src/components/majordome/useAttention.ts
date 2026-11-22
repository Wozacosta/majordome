import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  MajordomeBackupStatus,
  MajordomeVaultHistoryResult,
  ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { useProjects, useQuietThreadShells } from "../../state/entities";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { vaultBackupStatusesAtom, vaultHistoriesAtom } from "../../state/majordome";
import { useNowMinute } from "../../hooks/useNowMinute";
import { type AttentionCard, attentionCard, settledRunner } from "./attention.logic";
import { buildFeedRunItems } from "./feed.logic";
import { groupBrains, routinesMachine, runnerCopy } from "./brains.logic";
import { useMachineNames } from "./useMachineNames";

interface VaultCopy {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly brainId: string | null | undefined;
  readonly backup: MajordomeBackupStatus;
  readonly history: MajordomeVaultHistoryResult | null;
  readonly routinesRunner: MajordomeVaultHistoryResult["routinesRunner"] | null;
}

/**
 * What the sidebar's card says, or null when nothing needs the owner. It reads only what the daily
 * screens already keep: connections and AI accounts as servers push them, and each notes folder's
 * backup status and history. Nothing here asks a server on a timer.
 */
export function useAttention(): AttentionCard | null {
  const { primaryEnvironmentId, machineOf } = useMachineNames();
  const { environments } = useEnvironments();
  const providers = useEnvironmentProviders();
  const connected = new Set(
    environments
      .filter((environment) => environment.connection.phase === "connected")
      .map((environment) => environment.environmentId),
  );

  const projects = useProjects().filter((project) => !project.isScratch && !project.archivedAt);
  const threads = useQuietThreadShells();
  const nowMinute = useNowMinute();
  const backups = useAtomValue(
    vaultBackupStatusesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );
  const vaults = projects.flatMap((project, index) => {
    // A computer that is not connected has its own line; what it last said may be old.
    if (!connected.has(project.environmentId)) return [];
    const result = backups[index];
    const backup = result === undefined ? null : AsyncResult.getOrElse(result, () => null);
    return backup?.isVault === true ? [{ project, backup }] : [];
  });
  const histories = useAtomValue(
    vaultHistoriesAtom(
      JSON.stringify(vaults.map(({ project }) => [project.environmentId, project.id])),
    ),
  );
  const copies = vaults.map(({ project, backup }, index): VaultCopy => {
    const result = histories[index];
    const history = result === undefined ? null : AsyncResult.getOrElse(result, () => null);
    return {
      environmentId: project.environmentId,
      projectId: project.id,
      brainId: backup.brainId,
      backup,
      history,
      routinesRunner: settledRunner({
        runner: history?.routinesRunner ?? null,
        createdAt: project.createdAt,
        nowMinute,
      }),
    };
  });
  const brains = groupBrains(copies, primaryEnvironmentId);

  return attentionCard({
    machines: environments.map((environment) => {
      const { phase } = environment.connection;
      return {
        environmentId: environment.environmentId,
        name: machineOf(environment.environmentId),
        primary: environment.environmentId === primaryEnvironmentId,
        connection:
          phase === "connected"
            ? "connected"
            : phase === "connecting" || phase === "reconnecting"
              ? "connecting"
              : "disconnected",
      };
    }),
    runners: brains.map((brain) => ({
      key: brain.key,
      runner: runnerCopy(brain).routinesRunner,
      runsOn: routinesMachine(brain, machineOf),
    })),
    routines: brains.map((brain) => {
      const runner = runnerCopy(brain);
      return {
        key: brain.key,
        runner: { environmentId: runner.environmentId, machine: machineOf(runner.environmentId) },
        routinesStatus: runner.history?.routinesStatus,
        pausedRunsPerDay: runner.history?.pausedToday
          ? (runner.history.routineLimits?.runsPerDay ?? null)
          : null,
        memoryOverLimit: runner.history?.memoryOverLimit,
      };
    }),
    notes: copies,
    runs: buildFeedRunItems(
      threads,
      projects.map((project) => ({
        environmentId: project.environmentId,
        projectId: project.id,
        title: project.title,
      })),
    ),
    accounts: [...connected].map((environmentId) => ({
      environmentId,
      providers: providers.get(environmentId) ?? null,
    })),
  });
}
