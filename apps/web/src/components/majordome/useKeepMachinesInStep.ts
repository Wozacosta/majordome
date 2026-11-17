import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthAccessWriteScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useEffect } from "react";

import { isMajordome } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { authEnvironment } from "../../state/auth";
import { useProjects } from "../../state/entities";
import { majordomeEnvironment, vaultBackupStatusesAtom } from "../../state/majordome";
import { readEnvironmentScope, readPreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { groupBrains } from "./brains.logic";
import { type PeerLinkCopy, type PeerLinkPlan, peerLinkPlans } from "./peerLink.logic";
import { useMachineNames } from "./useMachineNames";

const DECLINED_STORAGE_KEY = "majordome.machinesNotKeptInStep";
const DeclinedPairs = Schema.Array(Schema.String);
const NO_PAIRS: ReadonlyArray<string> = [];

/** Pairs this app has tried to link since it started, so a failure is not tried over and over. */
const tried = new Set<string>();

/** Pairs of machines the owner chose not to keep in step, remembered by this app. */
export function useDeclinedPeerLinks() {
  const [declined, setDeclined] = useLocalStorage(DECLINED_STORAGE_KEY, NO_PAIRS, DeclinedPairs);
  return {
    declined: new Set(declined),
    decline: (key: string) =>
      setDeclined((pairs) => [...pairs.filter((pair) => pair !== key), key]),
    allow: (key: string) => setDeclined((pairs) => pairs.filter((pair) => pair !== key)),
  };
}

type LinkCopy = PeerLinkCopy & { readonly projectId: ProjectId };

/**
 * Links this computer's copy of the notes with the same notes on another server. Null when it
 * worked, "no-access" when this app may not grant access on the other server, else what went wrong.
 */
export function useLinkMachines() {
  const createPairingCredential = useAtomCommand(authEnvironment.createPairingCredential, {
    reportFailure: false,
  });
  const linkPeer = useAtomCommand(majordomeEnvironment.linkPeer, { reportFailure: false });
  const { machineOf } = useMachineNames();

  return async (plan: PeerLinkPlan<LinkCopy>): Promise<string | null> => {
    const other = plan.other.environmentId;
    const connection = readPreparedConnection(other);
    if (connection === null || !readEnvironmentScope(other, AuthAccessWriteScope)) {
      return "no-access";
    }
    const failure = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
      const error = squashAtomCommandFailure(result);
      return error instanceof Error ? error.message : String(error);
    };
    // Only the access the two servers need to exchange notes.
    const pairing = await createPairingCredential({
      environmentId: other,
      input: {
        label: `Majordome on ${machineOf(plan.local.environmentId)}`,
        scopes: [AuthAccessWriteScope],
      },
    });
    if (pairing._tag === "Failure") return failure(pairing);
    const linked = await linkPeer({
      environmentId: plan.local.environmentId,
      input: {
        projectId: plan.local.projectId,
        url: connection.httpBaseUrl,
        credential: pairing.value.credential,
        label: machineOf(other),
      },
    });
    return linked._tag === "Failure" ? failure(linked) : null;
  };
}

/** Every vault copy with what its server says about its other machine, grouped into brains. */
function usePeerLinkBrains(localEnvironmentId: EnvironmentId | null) {
  const listed = useProjects();
  const projects = isMajordome
    ? listed.filter((project) => !project.isScratch && !project.archivedAt)
    : [];
  const statuses = useAtomValue(
    vaultBackupStatusesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );
  const copies = projects.flatMap((project, index): ReadonlyArray<LinkCopy> => {
    const result = statuses[index];
    const status = result === undefined ? null : AsyncResult.getOrElse(result, () => null);
    return status?.isVault === true
      ? [
          {
            environmentId: project.environmentId,
            projectId: project.id,
            brainId: status.brainId,
            peer: status.peer,
          },
        ]
      : [];
  });
  return groupBrains(copies, localEnvironmentId);
}

/**
 * In the desktop app, links this computer's notes with the same notes on another connected server
 * as soon as both are seen, so the owner has nothing to set up. Once per pair while the app runs.
 */
function useKeepMachinesInStep() {
  const { localEnvironmentId } = useMachineNames();
  const { declined } = useDeclinedPeerLinks();
  const link = useLinkMachines();
  const plan = peerLinkPlans({
    brains: usePeerLinkBrains(localEnvironmentId),
    localEnvironmentId,
    declined,
  }).find((candidate) => !tried.has(candidate.key));
  // Without this the Backup page says what to do; nothing is tried, so it can be tried later.
  const mayLink =
    plan !== undefined && readEnvironmentScope(plan.other.environmentId, AuthAccessWriteScope);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Linking is a request to two servers, made once when their statuses show the same notes with no working link between them.
  useEffect(() => {
    if (plan === undefined || !mayLink || tried.has(plan.key)) return;
    tried.add(plan.key);
    // Quiet either way: the Backup page says whether the two are in step, and offers the button.
    void link(plan);
  }, [plan, mayLink, link]);
}

/** Mounted once, in the app's frame: see `useKeepMachinesInStep`. */
export function KeepMachinesInStep() {
  useKeepMachinesInStep();
  return null;
}
