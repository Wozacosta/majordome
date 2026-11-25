import type { EnvironmentId, MajordomeBackupStatus } from "@t3tools/contracts";

import type { Brain, BrainCopy } from "./brains.logic";

/** One server's copy of a brain, with what its backup status says about its other machine. */
export interface PeerLinkCopy extends BrainCopy {
  /** Undefined from a server too old to keep notes in step directly. */
  readonly peer: MajordomeBackupStatus["peer"];
}

export interface PeerLinkPlan<C extends PeerLinkCopy> {
  /** Names the pair, to try it once and to remember the owner turned it off. */
  readonly key: string;
  /** The copy on this computer's server, which does the work. */
  readonly local: C;
  readonly other: C;
  /**
   * Whether the owner agreed to these two exchanging notes: they said yes to this pair, or the
   * link is one to make again. Only such a pair is linked without asking, since any connected
   * server can claim to hold the same notes.
   */
  readonly approved: boolean;
}

/**
 * Which pairs of copies to link so their notes stay in step: for each brain on this computer and
 * on another connected server, this computer's copy with the other, unless a link already works.
 */
export function peerLinkPlans<C extends PeerLinkCopy>(input: {
  readonly brains: ReadonlyArray<Brain<C>>;
  /** The desktop app's own server; null in a browser or on the phone, which link nothing. */
  readonly localEnvironmentId: EnvironmentId | null;
  /** Pairs the owner agreed to keep in step. */
  readonly approved: ReadonlySet<string>;
  /** Pairs the owner chose not to keep in step. */
  readonly declined: ReadonlySet<string>;
}): ReadonlyArray<PeerLinkPlan<C>> {
  const { localEnvironmentId } = input;
  if (localEnvironmentId === null) return [];
  return input.brains.flatMap((brain) => {
    const local = brain.copies.find((copy) => copy.environmentId === localEnvironmentId);
    if (local === undefined || !local.brainId || local.peer === undefined) return [];
    const linked = local.peer;
    if (linked !== null && !(linked.linkedHere && linked.needsReconnect)) return [];
    const other = brain.copies.find(
      (copy) =>
        copy.environmentId !== localEnvironmentId &&
        copy.peer !== undefined &&
        // A link that needs making again is made with the same machine, not another.
        (linked === null || linked.environmentId === copy.environmentId) &&
        // Two machines that each did the work would keep interrupting each other.
        !(copy.peer?.linkedHere === true && copy.peer.environmentId === localEnvironmentId),
    );
    if (other === undefined) return [];
    const key = `${brain.key}|${local.environmentId}|${other.environmentId}`;
    if (input.declined.has(key)) return [];
    return [{ key, local, other, approved: linked !== null || input.approved.has(key) }];
  });
}

/** The same name `peerLinkPlans` gives a pair, for a link that already exists. */
export function linkedPairKey(brainKey: string, copy: PeerLinkCopy): string | null {
  return copy.peer?.linkedHere === true && copy.peer.environmentId !== null
    ? `${brainKey}|${copy.environmentId}|${copy.peer.environmentId}`
    : null;
}
