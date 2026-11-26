import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { majordomeEnvironment, vaultHistoriesAtom } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { machineInSentence } from "./brains.logic";
import { READING_MEASURE_CLASS, StatusLine } from "./paper";
import { type RoutinesClash, routinesClashes } from "./servers.logic";
import { useMachineNames } from "./useMachineNames";
import { useMajordomeVaults } from "./useMajordomeVaults";

/** The notes folders whose routines run on several computers at once, see `routinesClashes`. */
function useRoutinesClashes(): ReadonlyArray<RoutinesClash> {
  const { vaults } = useMajordomeVaults();
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
  return routinesClashes(
    vaults.map((vault) => ({
      key: vault.key,
      title: vault.title,
      copies: vault.copies.map((copy) => ({
        environmentId: copy.environmentId,
        projectId: copy.projectId,
        name: machineOf(copy.environmentId),
        routinesRunner: runnerOf.get(`${copy.environmentId}:${copy.projectId}`),
      })),
    })),
  );
}

/**
 * Says when two computers both run the same routines, and lets the owner keep one. The others
 * are told directly, since the notes that would have told them never arrived.
 */
export function RoutinesClashNotice() {
  const clashes = useRoutinesClashes();
  const runElsewhere = useAtomCommand(majordomeEnvironment.runRoutinesElsewhere, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keep = async (clash: RoutinesClash, kept: RoutinesClash["runners"][number]) => {
    setBusy(`${clash.key}:${kept.environmentId}`);
    setError(null);
    for (const other of clash.runners) {
      if (other.environmentId === kept.environmentId) continue;
      const result = await runElsewhere({
        environmentId: other.environmentId,
        input: { projectId: other.projectId, environmentId: kept.environmentId, label: kept.name },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        setError(
          `${other.name} could not be told to stop. It may need updating first. ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
        break;
      }
    }
    setBusy(null);
  };

  return clashes.map((clash) => (
    <div key={clash.key} className="mb-4 flex flex-col gap-2">
      <StatusLine tone="warning" className={READING_MEASURE_CLASS}>
        Your routines for {clash.title} run on{" "}
        {clash.runners.map((runner) => machineInSentence(runner.name)).join(" and ")} at the same
        time, so each routine runs more than once. Choose the one that should run them; the other
        stops.
      </StatusLine>
      <div className="flex flex-wrap gap-2 ps-4">
        {clash.runners.map((runner) => (
          <Button
            key={runner.environmentId}
            size="xs"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void keep(clash, runner)}
          >
            {busy === `${clash.key}:${runner.environmentId}` ? <Spinner size="sm" /> : null}
            Only on {machineInSentence(runner.name)}
          </Button>
        ))}
      </div>
      {error === null ? null : <StatusLine tone="error">{error}</StatusLine>}
    </div>
  ));
}
