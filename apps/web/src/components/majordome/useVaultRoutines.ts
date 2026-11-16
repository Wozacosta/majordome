import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { environmentScheduledTasksAtom, vaultHistoriesAtom } from "../../state/majordome";
import { selectRoutines } from "./routines.logic";
import type { MajordomeVault } from "./topics.logic";

/**
 * A notes folder's routines and upcoming reminders, kept current by each server's own list of
 * what it has scheduled, and the copy on the server that runs the routines.
 */
export function useVaultRoutines(vault: Pick<MajordomeVault, "copies"> | null) {
  const copies = vault?.copies ?? [];
  const tasks = useAtomValue(
    environmentScheduledTasksAtom(JSON.stringify(copies.map((copy) => copy.environmentId))),
  );
  const histories = useAtomValue(
    vaultHistoriesAtom(JSON.stringify(copies.map((copy) => [copy.environmentId, copy.projectId]))),
  ).map((result) => (result === undefined ? null : AsyncResult.getOrElse(result, () => null)));
  const runnerIndex = histories.findIndex((history) => history?.routinesRunner === "this-server");
  // Until a server says it runs them, the shown copy's routines are the ones to show.
  const runner = copies[Math.max(runnerIndex, 0)] ?? null;
  return {
    ...selectRoutines({
      copies: copies.map((copy, index) => {
        const result = tasks[index];
        const data = result === undefined ? null : AsyncResult.getOrElse(result, () => null);
        return { ...copy, tasks: data?.tasks ?? null, timeZone: data?.timeZone };
      }),
      runner,
    }),
    runner,
    runnerHistory: histories[Math.max(runnerIndex, 0)] ?? null,
    /** Another server runs the routines and this window cannot reach it. */
    runnerUnreachable:
      runnerIndex < 0 && histories.some((history) => history?.routinesRunner === "another-server"),
    loading: tasks.some((result) => result._tag === "Initial"),
  };
}
