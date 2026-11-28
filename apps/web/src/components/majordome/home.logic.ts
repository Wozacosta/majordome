import { scopedProjectKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  MajordomeRoutinesRunner,
  MajordomeRoutinesStatus,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

import { groupBrains } from "./brains.logic";

/**
 * The copy on the owner's always-on computer: one that runs routines, is not this window's own,
 * and is connected. A server cut off from the notes still names itself, so with several it is the
 * one most recently in step with another computer, then the first.
 */
export function alwaysOnCopy<
  C extends {
    readonly environmentId: EnvironmentId;
    readonly routinesRunner: MajordomeRoutinesRunner | null | undefined;
    readonly lastInStepAt?: string | null | undefined;
  },
>(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly connected: ReadonlyArray<EnvironmentId>;
  readonly copies: ReadonlyArray<C>;
}): C | undefined {
  let latest: C | undefined;
  for (const copy of input.copies) {
    if (
      copy.routinesRunner !== "this-server" ||
      copy.environmentId === input.primaryEnvironmentId ||
      !input.connected.includes(copy.environmentId)
    ) {
      continue;
    }
    if (latest === undefined || (copy.lastInStepAt ?? "") > (latest.lastInStepAt ?? "")) {
      latest = copy;
    }
  }
  return latest;
}

/**
 * Whether a server's assistant can answer a conversation, from what it says about its routines.
 * Routines it has not made yet still leave a signed-in AI; an older server says nothing.
 */
export function assistantCanAnswer(status: MajordomeRoutinesStatus | undefined): boolean {
  return status === undefined || status.ready || status.reason === "not-created";
}

/** One computer's copy of a notes folder, with what its server says about routines. */
export interface HomeCopy {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly brainId?: string | null | undefined;
  /** Undefined while its server has not answered; null when it could not. */
  readonly routinesRunner: MajordomeRoutinesRunner | null | undefined;
  readonly assistantReady: boolean;
  /** When its notes were last exchanged with another computer, as its server's ISO time. */
  readonly lastInStepAt?: string | null | undefined;
}

/**
 * Where a notes folder's conversations are kept, so every device shows the same ones: the
 * always-on server when there is one, else this computer.
 */
export type ConversationHome =
  | {
      readonly kind: "ready";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
    }
  /**
   * Another computer keeps them and this window cannot reach it. `here` is this computer's own
   * copy of the notes, which can take them over when that computer is gone for good.
   */
  | {
      readonly kind: "unreachable";
      readonly here: {
        readonly environmentId: EnvironmentId;
        readonly projectId: ProjectId;
      } | null;
    }
  | { readonly kind: "loading" };

/**
 * The home of one notes folder, from its copies with the shown one first. A server whose AI is
 * signed out cannot answer, so the conversations stay on the shown copy until it can.
 */
export function conversationHome(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly connected: ReadonlyArray<EnvironmentId>;
  readonly copies: readonly [HomeCopy, ...Array<HomeCopy>];
  /** Some connected computer has not said yet which notes it holds. */
  readonly waiting?: boolean;
}): ConversationHome {
  const shown = input.copies[0];
  const server = alwaysOnCopy(input);
  if (server !== undefined) {
    const home = server.assistantReady ? server : shown;
    return { kind: "ready", environmentId: home.environmentId, projectId: home.projectId };
  }
  const runsHere = input.copies.some(
    (copy) =>
      copy.routinesRunner === "this-server" && copy.environmentId === input.primaryEnvironmentId,
  );
  if (runsHere) {
    return { kind: "ready", environmentId: shown.environmentId, projectId: shown.projectId };
  }
  if (
    input.waiting === true ||
    input.copies.some(
      (copy) => copy.routinesRunner === undefined && input.connected.includes(copy.environmentId),
    )
  ) {
    return { kind: "loading" };
  }
  if (input.copies.some((copy) => copy.routinesRunner === "another-server")) {
    const here = input.copies.find((copy) => copy.environmentId === input.primaryEnvironmentId);
    return {
      kind: "unreachable",
      here:
        here === undefined
          ? null
          : { environmentId: here.environmentId, projectId: here.projectId },
    };
  }
  return { kind: "ready", environmentId: shown.environmentId, projectId: shown.projectId };
}

/** Every copy's `scopedProjectKey` with the home of its notes folder. */
export function conversationHomes(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly connected: ReadonlyArray<EnvironmentId>;
  readonly copies: ReadonlyArray<HomeCopy>;
  readonly waiting?: boolean;
}): ReadonlyMap<string, ConversationHome> {
  const homes = new Map<string, ConversationHome>();
  for (const brain of groupBrains(input.copies, input.primaryEnvironmentId)) {
    const home = conversationHome({ ...input, copies: brain.copies });
    for (const copy of brain.copies) {
      homes.set(
        scopedProjectKey({ environmentId: copy.environmentId, projectId: copy.projectId }),
        home,
      );
    }
  }
  return homes;
}

/** Whether a notes folder's conversations are kept on `copy`, on another computer than this window's. */
export function keepsConversations(
  copy: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
  primaryEnvironmentId: EnvironmentId | null,
  homes: ReadonlyMap<string, ConversationHome>,
): boolean {
  const home = homes.get(
    scopedProjectKey({ environmentId: copy.environmentId, projectId: copy.projectId }),
  );
  return (
    copy.environmentId !== primaryEnvironmentId &&
    home?.kind === "ready" &&
    home.environmentId === copy.environmentId
  );
}

/** When each conversation's latest reply finished, by `scopedThreadKey`; "" while there is none. */
export function finishedReplies(
  threads: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly latestRun?: { readonly completedAt?: string | null | undefined } | null | undefined;
  }>,
): ReadonlyMap<string, string> {
  return new Map(
    threads.map((thread) => [
      scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
      thread.latestRun?.completedAt ?? "",
    ]),
  );
}

/**
 * Whether a conversation already listed `before` has finished a reply since. One that is listed
 * for the first time does not count: it was read with its past, not seen finishing.
 */
export function replyFinishedSince(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): boolean {
  for (const [key, finishedAt] of after) {
    if (finishedAt !== "" && before.has(key) && before.get(key) !== finishedAt) return true;
  }
  return false;
}
