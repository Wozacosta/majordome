import { useAtomValue } from "@effect/atom-react";
import type { MajordomeRoutineRun } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { vaultRoutineRunsAtom } from "../../state/majordome";
import type { MajordomeVault } from "./topics.logic";

/**
 * The runs each of a notes folder's servers logged from `fromMs` up to `untilMs`, each with the
 * `RoutineItem.key` of its routine or reminder. Read again whenever a run starts or ends.
 */
export function useRoutineRunLog(
  vault: Pick<MajordomeVault, "copies">,
  range: { readonly fromMs: number; readonly untilMs: number; readonly nowMs: number },
): ReadonlyArray<{ readonly itemKey: string; readonly run: MajordomeRoutineRun }> {
  // A stretch that has not begun has no runs to read.
  const refs =
    range.fromMs > range.nowMs
      ? []
      : vault.copies.map((copy) => [copy.environmentId, copy.projectId] as const);
  const answers = useAtomValue(
    vaultRoutineRunsAtom(
      JSON.stringify({
        refs,
        from: new Date(range.fromMs).toISOString(),
        to: new Date(range.untilMs).toISOString(),
      }),
    ),
  );
  return answers.flatMap((answer, index) => {
    // A server from before the calendar has no log; its routines still show their last run.
    const runs = AsyncResult.getOrElse(answer, () => null)?.runs ?? [];
    const environmentId = refs[index]?.[0];
    return runs.map((run) => ({ itemKey: `${environmentId}:${run.taskId}`, run }));
  });
}
