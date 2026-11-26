import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { machineInSentence } from "./brains.logic";
import { READING_MEASURE_CLASS, StatusLine } from "./paper";
import { type RoutinesClash, routinesClashes } from "./servers.logic";
import { useBrainRunners } from "./useBrainRunners";

/**
 * Says when two computers both run the same routines, and lets the owner keep one. The others
 * are told directly, since the notes that would have told them never arrived.
 */
export function RoutinesClashNotice() {
  const clashes = routinesClashes(useBrainRunners().brains);
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
        {clash.runners.map((runner) => machineInSentence(runner.name)).join(" and ")}, so each runs
        twice. Keep one:
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
