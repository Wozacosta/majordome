import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { vaultHistoriesAtom } from "../../state/majordome";
import { phoneEnvironmentId } from "./phone.logic";
import { useMachineNames } from "./useMachineNames";

export interface PhoneEnvironment {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  /** False when the phone is set up on another computer than this window's own. */
  readonly isThisComputer: boolean;
}

/**
 * The computer a phone is set up on, see `phoneEnvironmentId`. Null until the window's own
 * computer is known and every other connected one has said whether it runs routines.
 */
export function usePhoneEnvironment(): PhoneEnvironment | null {
  const { primaryEnvironmentId, machineOf } = useMachineNames();
  const { environments } = useEnvironments();
  const connected = environments
    .filter((environment) => environment.connection.phase === "connected")
    .map((environment) => environment.environmentId);
  // This window's own computer never wins, so only the other ones are asked.
  const projects = useProjects().filter(
    (project) =>
      !project.isScratch &&
      !project.archivedAt &&
      project.environmentId !== primaryEnvironmentId &&
      connected.includes(project.environmentId),
  );
  const histories = useAtomValue(
    vaultHistoriesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );
  const environmentId = phoneEnvironmentId({
    primaryEnvironmentId,
    connected,
    copies: projects.map((project, index) => {
      const result = histories[index];
      const history = result === undefined ? null : AsyncResult.getOrElse(result, () => null);
      return {
        environmentId: project.environmentId,
        routinesRunner: history?.isVault === true ? history.routinesRunner : null,
      };
    }),
  });
  if (environmentId === null) return null;
  const isThisComputer = environmentId === primaryEnvironmentId;
  // Waiting keeps the page from showing this computer's address, then another's.
  if (isThisComputer && histories.some((result) => result._tag === "Initial")) return null;
  return { environmentId, name: machineOf(environmentId), isThisComputer };
}
