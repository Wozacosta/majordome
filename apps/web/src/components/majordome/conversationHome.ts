import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { isMajordome } from "../../env";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import {
  majordomeEnvironment,
  vaultBackupStatusesAtom,
  vaultHistoriesAtom,
} from "../../state/majordome";
import { environmentSummaries } from "../../state/presentation";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { environmentProjects } from "../../state/projects";
import { toastManager } from "../ui/toast";
import { statusBrainId } from "./brains.logic";
import {
  assistantCanAnswer,
  type ConversationHome,
  conversationHomes,
  type HomeCopy,
} from "./home.logic";

const NO_HOMES: ReadonlyMap<string, ConversationHome> = new Map();

/**
 * Where each notes folder's conversations are kept, by the `scopedProjectKey` of each of its
 * copies. An atom, so the code that starts a conversation outside React reads the same answer.
 */
export const conversationHomesAtom = Atom.make((get) => {
  if (!isMajordome) return NO_HOMES;
  const projects = get(environmentProjects.projectsAtom).filter(
    (project) => !project.isScratch && !project.archivedAt,
  );
  const key = JSON.stringify(projects.map((project) => [project.environmentId, project.id]));
  const statuses = get(vaultBackupStatusesAtom(key));
  const histories = get(vaultHistoriesAtom(key));
  const connected = get(environmentSummaries.connectedEnvironmentIdsAtom);
  let waiting = false;
  const copies = projects.flatMap((project, index): ReadonlyArray<HomeCopy> => {
    const statusResult = statuses[index];
    const historyResult = histories[index];
    const brainId = statusBrainId(statusResult);
    const status =
      statusResult === undefined ? null : AsyncResult.getOrElse(statusResult, () => null);
    const pending = historyResult === undefined || historyResult._tag === "Initial";
    // A computer that is away never answers, so only a connected one is waited for.
    if (brainId === undefined || (pending && status === null)) {
      waiting ||= connected.includes(project.environmentId);
      return [];
    }
    const history = pending ? null : AsyncResult.getOrElse(historyResult, () => null);
    if (!(history?.isVault ?? status?.isVault ?? false)) return [];
    return [
      {
        environmentId: project.environmentId,
        projectId: project.id,
        brainId,
        routinesRunner: pending ? undefined : (history?.routinesRunner ?? null),
        assistantReady: assistantCanAnswer(history?.routinesStatus),
        lastInStepAt: status?.peer?.lastInStepAt ?? null,
      },
    ];
  });
  return conversationHomes({
    primaryEnvironmentId: get(primaryEnvironmentIdAtom),
    connected,
    copies,
    waiting,
  });
}).pipe(Atom.withLabel("majordome:conversation-homes"));

/**
 * This computer's copy of a notes folder whose owner asked, from the notice, to keep its
 * conversations and routines here. The app's frame shows the question for it.
 */
export const takeOverHereAtom = Atom.make<{
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("majordome:take-over-here"));

let takeOverNotice: string | undefined;

/**
 * Where a new conversation in this notes folder starts: its home, whichever copy was asked for.
 * Null, after telling the owner why, while the home cannot take it. A project that is not a notes
 * folder stays as given.
 */
export function conversationHomeRef(ref: ScopedProjectRef): ScopedProjectRef | null {
  const home = appAtomRegistry.get(conversationHomesAtom).get(scopedProjectKey(ref));
  if (home === undefined) return ref;
  if (home.kind === "ready") return scopeProjectRef(home.environmentId, home.projectId);
  if (home.kind === "loading") {
    toastManager.add({
      type: "info",
      title: "Still checking where your conversations are kept",
      description: "Try again in a moment.",
    });
    return null;
  }
  const here = home.here;
  // A server that is gone for good never comes back, so the way out is offered with the news.
  const canTakeOver =
    here !== null &&
    appAtomRegistry.get(majordomeEnvironment.runRoutinesHere.permissionAtom(here.environmentId));
  if (here === null || !canTakeOver) {
    toastManager.add({
      type: "warning",
      title: "Your server can't be reached",
      description:
        "Conversations are kept there, so wait until it is back, or check Status in Settings.",
    });
    return null;
  }
  const title =
    appAtomRegistry
      .get(environmentProjects.projectsAtom)
      .find(
        (project) => project.environmentId === here.environmentId && project.id === here.projectId,
      )?.title ?? "your notes";
  // One click can ask twice, and the offer is the same each time: one notice.
  if (takeOverNotice !== undefined) toastManager.close(takeOverNotice);
  const toastId = toastManager.add({
    type: "warning",
    title: "Your server can't be reached",
    description: "Conversations are kept there. If it is gone, this computer can take over.",
    actionProps: {
      children: "Use this computer",
      onClick: () => {
        toastManager.close(toastId);
        appAtomRegistry.set(takeOverHereAtom, { ...here, title });
      },
    },
  });
  takeOverNotice = toastId;
  return null;
}
