import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, MajordomeRoutinesRunner, ProjectId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

/**
 * One server's copy of a vault. Copies with the same `brainId` (their history's root commit) are
 * one brain: the owner's Mac and an always-on server holding clones of the same notes.
 */
export interface BrainCopy {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** Absent from older servers and null before the first commit: such a copy is its own brain. */
  readonly brainId?: string | null | undefined;
}

export interface Brain<C extends BrainCopy> {
  readonly key: string;
  /** The copy on the window's own server first, then the others in the order given. */
  readonly copies: readonly [C, ...Array<C>];
}

export function brainKey(copy: BrainCopy): string {
  return copy.brainId
    ? `brain:${copy.brainId}`
    : scopedProjectKey({ environmentId: copy.environmentId, projectId: copy.projectId });
}

/** The copies grouped into brains, in the order each brain first appears. */
export function groupBrains<C extends BrainCopy>(
  copies: ReadonlyArray<C>,
  primaryEnvironmentId: EnvironmentId | null,
): ReadonlyArray<Brain<C>> {
  const groups = new Map<string, Array<C>>();
  for (const copy of copies) {
    const key = brainKey(copy);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [copy]);
    else group.push(copy);
  }
  return [...groups].map(([key, group]) => {
    const ordered = [
      ...group.filter((copy) => copy.environmentId === primaryEnvironmentId),
      ...group.filter((copy) => copy.environmentId !== primaryEnvironmentId),
    ];
    return { key, copies: [ordered[0]!, ...ordered.slice(1)] };
  });
}

/**
 * A server as the owner names it: "This Mac" for the desktop app's own server, otherwise the name
 * the connection was saved under.
 */
export function machineName(
  environmentId: EnvironmentId,
  input: {
    readonly primaryEnvironmentId: EnvironmentId | null;
    /** Set in the desktop app, whose own server is the primary one. */
    readonly desktop: "mac" | "other" | null;
    readonly labels: ReadonlyMap<EnvironmentId, string>;
  },
): string {
  if (environmentId === input.primaryEnvironmentId && input.desktop !== null) {
    return input.desktop === "mac" ? "This Mac" : "This computer";
  }
  return input.labels.get(environmentId)?.trim() || "Another computer";
}

/** "This Mac" as it reads mid-sentence: "on this Mac". */
export function machineInSentence(name: string): string {
  return name.replace(/^This /, "this ");
}

/**
 * The name over one copy where several are listed: the brain's title when there are several
 * brains, the machine when the brain is on several, both when both. Null when there is one copy.
 */
export function copyLabel(input: {
  readonly title: string;
  /** Null when the brain is on one server only. */
  readonly machine: string | null;
  readonly severalBrains: boolean;
}): string | null {
  if (input.machine === null) return input.severalBrains ? input.title : null;
  return input.severalBrains
    ? `${input.title} on ${machineInSentence(input.machine)}`
    : input.machine;
}

/** Every copy of every brain, in brain order, each with its `copyLabel`. */
export function labelCopies<C extends BrainCopy & { readonly title: string }>(
  brains: ReadonlyArray<Brain<C>>,
  machineOf: (environmentId: EnvironmentId) => string,
): ReadonlyArray<{ readonly copy: C; readonly label: string | null }> {
  return brains.flatMap((brain) =>
    brain.copies.map((copy) => ({
      copy,
      label: copyLabel({
        title: copy.title,
        machine: brain.copies.length > 1 ? machineOf(copy.environmentId) : null,
        severalBrains: brains.length > 1,
      }),
    })),
  );
}

/** The brain id a backup status gives: undefined while it loads, null when none is known. */
export function statusBrainId(
  result:
    | AsyncResult.AsyncResult<{ readonly brainId?: string | null | undefined }, unknown>
    | undefined,
): string | null | undefined {
  if (result === undefined || result._tag === "Initial") return undefined;
  return AsyncResult.getOrElse(result, () => null)?.brainId ?? null;
}

/**
 * Which server runs the brain's routines, by name, when the brain is on several servers and one
 * of them does.
 */
export function routinesMachine<
  C extends BrainCopy & { readonly routinesRunner: MajordomeRoutinesRunner | null },
>(brain: Brain<C>, machineOf: (environmentId: EnvironmentId) => string): string | null {
  if (brain.copies.length < 2) return null;
  const runner = brain.copies.find((copy) => copy.routinesRunner === "this-server");
  return runner === undefined ? null : machineOf(runner.environmentId);
}

/** The copy on the server that runs the brain's routines, else the brain's first copy. */
export function runnerCopy<
  C extends BrainCopy & { readonly routinesRunner: MajordomeRoutinesRunner },
>(brain: Brain<C>): C {
  return brain.copies.find((copy) => copy.routinesRunner === "this-server") ?? brain.copies[0];
}
