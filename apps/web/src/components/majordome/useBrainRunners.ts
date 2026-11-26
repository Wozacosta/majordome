import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { vaultHistoriesAtom } from "../../state/majordome";
import type { RunnerBrain } from "./servers.logic";
import { useMachineNames } from "./useMachineNames";
import { useMajordomeVaults } from "./useMajordomeVaults";

/** Every notes folder with, for each computer's copy, whether that computer runs its routines. */
export function useBrainRunners(): {
  readonly brains: ReadonlyArray<RunnerBrain>;
  readonly activeKey: string | null;
} {
  const { vaults, activeVault } = useMajordomeVaults();
  const { machineOf } = useMachineNames();
  const copies = vaults.flatMap((vault) => vault.copies);
  const histories = useAtomValue(
    vaultHistoriesAtom(JSON.stringify(copies.map((copy) => [copy.environmentId, copy.projectId]))),
  );
  const runnerOf = new Map(
    copies.map((copy, index) => {
      const result = histories[index];
      const history = result === undefined ? null : AsyncResult.getOrElse(result, () => null);
      return [
        `${copy.environmentId}:${copy.projectId}`,
        history?.isVault === true ? history.routinesRunner : undefined,
      ] as const;
    }),
  );
  return {
    brains: vaults.map((vault) => ({
      key: vault.key,
      title: vault.title,
      copies: vault.copies.map((copy) => ({
        environmentId: copy.environmentId,
        projectId: copy.projectId,
        name: machineOf(copy.environmentId),
        routinesRunner: runnerOf.get(`${copy.environmentId}:${copy.projectId}`),
      })),
    })),
    activeKey: activeVault?.key ?? null,
  };
}
