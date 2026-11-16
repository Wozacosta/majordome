import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  MajordomeRoutineLimits,
  MajordomeRoutinesRunner,
  ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import {
  majordomeEnvironment,
  vaultBackupStatusesAtom,
  vaultHistoriesAtom,
} from "../../state/majordome";
import { groupBrains, runnerCopy, statusBrainId } from "./brains.logic";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { Entry, EntryList, Muted, READING_MEASURE_CLASS, SectionLabel } from "./paper";
import { ROUTINES_INSET_CLASS } from "./RoutineEntry";

const MAX_RUN_MINUTES = 24 * 60;
const MAX_RUNS_PER_DAY = 1_000;

interface LimitsVault {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly limits: MajordomeRoutineLimits;
}

/** A whole number from 1 to `max`, or null. */
function parseLimit(draft: string, max: number): number | null {
  const value = Number(draft);
  return Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

/** The limits on unattended runs of each vault, on the Routines screen. */
export function RoutineLimitsSection() {
  const projects = useProjects().filter((project) => !project.isScratch && !project.archivedAt);
  const key = JSON.stringify(projects.map((project) => [project.environmentId, project.id]));
  const results = useAtomValue(vaultHistoriesAtom(key));
  // The backup status says which brain each copy is.
  const statuses = useAtomValue(vaultBackupStatusesAtom(key));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const copies: Array<
    LimitsVault & {
      readonly brainId: string | null;
      readonly routinesRunner: MajordomeRoutinesRunner;
    }
  > = [];
  projects.forEach((project, index) => {
    const result = results[index];
    const history = result === undefined ? null : AsyncResult.getOrElse(result, () => null);
    const brainId = statusBrainId(statuses[index]);
    if (!history?.isVault || history.routineLimits === undefined || brainId === undefined) return;
    copies.push({
      environmentId: project.environmentId,
      projectId: project.id,
      title: project.title,
      limits: history.routineLimits,
      brainId,
      routinesRunner: history.routinesRunner,
    });
  });
  // The limits live in the brain's notes, so each brain shows once, from the server that runs it.
  const vaults = groupBrains(copies, primaryEnvironmentId).map(runnerCopy);
  if (vaults.length === 0) return null;

  return (
    <section>
      <div className={cn("mb-2 flex", ROUTINES_INSET_CLASS)}>
        <SectionLabel>Limits</SectionLabel>
      </div>
      <EntryList>
        {vaults.map((vault) => (
          <VaultLimitsRows
            // Saved limits come back through the history, which resets the drafts.
            key={`${vault.environmentId}:${vault.projectId}:${vault.limits.runMinutes}:${vault.limits.runsPerDay}`}
            vault={vault}
            showVaultName={vaults.length > 1}
          />
        ))}
      </EntryList>
    </section>
  );
}

function VaultLimitsRows({
  vault,
  showVaultName,
}: {
  readonly vault: LimitsVault;
  readonly showVaultName: boolean;
}) {
  const canSave = useAtomValue(
    majordomeEnvironment.setRoutineLimits.permissionAtom(vault.environmentId),
  );
  const save = useAtomCommand(majordomeEnvironment.setRoutineLimits, {
    label: "save routine limits",
  });
  const [minutesDraft, setMinutesDraft] = useState(String(vault.limits.runMinutes));
  const [runsDraft, setRunsDraft] = useState(String(vault.limits.runsPerDay));
  const [busy, setBusy] = useState(false);
  const runMinutes = parseLimit(minutesDraft, MAX_RUN_MINUTES);
  const runsPerDay = parseLimit(runsDraft, MAX_RUNS_PER_DAY);
  const changed = runMinutes !== vault.limits.runMinutes || runsPerDay !== vault.limits.runsPerDay;
  const prefix = showVaultName ? `${vault.title}: ` : "";

  const submit = async () => {
    if (runMinutes === null || runsPerDay === null) return;
    setBusy(true);
    const result = await save({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, limits: { runMinutes, runsPerDay } },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not save the limits",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <>
      <Entry
        className={ROUTINES_INSET_CLASS}
        title={`${prefix}Stop a run after`}
        actions={
          <LimitInput
            label="minutes"
            value={minutesDraft}
            max={MAX_RUN_MINUTES}
            disabled={!canSave || busy}
            invalid={runMinutes === null}
            onChange={setMinutesDraft}
          />
        }
      >
        <Muted className={READING_MEASURE_CLASS}>
          A routine or inbox digest still working after this many minutes is stopped, and you're
          told it couldn't finish. Time waiting for your answer doesn't count.
        </Muted>
      </Entry>
      <Entry
        className={ROUTINES_INSET_CLASS}
        title={`${prefix}Runs per day`}
        actions={
          <div className="flex items-center gap-2">
            <LimitInput
              label="runs"
              value={runsDraft}
              max={MAX_RUNS_PER_DAY}
              disabled={!canSave || busy}
              invalid={runsPerDay === null}
              onChange={setRunsDraft}
            />
            <Button
              size="xs"
              disabled={!canSave || busy || !changed || runMinutes === null || runsPerDay === null}
              onClick={() => void submit()}
            >
              Save
            </Button>
          </div>
        }
      >
        <Muted className={READING_MEASURE_CLASS}>
          Routines and inbox digests start at most this many runs a day. After that they pause until
          tomorrow and you're told once. “Run now” still works.
        </Muted>
      </Entry>
    </>
  );
}

function LimitInput({
  label,
  value,
  max,
  disabled,
  invalid,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly max: number;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <Input
        size="sm"
        type="number"
        min={1}
        max={max}
        step={1}
        className="w-20"
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {label}
    </label>
  );
}
