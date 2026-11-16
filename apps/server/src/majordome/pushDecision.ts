/**
 * Which vault runs reach the owner's phone. Only three do: a run waiting for an answer, "Start my
 * day" finishing, and a run that couldn't finish. Each carries a key so one run notifies once.
 * A runner whose routines can't run at all notifies once too, until it recovers.
 */

import type { EnvironmentId, MajordomeRoutinesStatus } from "@t3tools/contracts";
import {
  type ProjectThreadAwarenessV2Input,
  projectThreadAwarenessV2,
} from "@t3tools/shared/agentAwareness";

export type VaultPushKind = "waiting" | "start-my-day" | "failed";

/** What the service worker shows. `url` opens the thread when the notification is clicked. */
export interface VaultPushMessage {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly url: string;
}

export interface VaultPush extends VaultPushMessage {
  readonly kind: VaultPushKind;
  readonly dedupeKey: string;
}

export type VaultPushThread = ProjectThreadAwarenessV2Input["thread"] & {
  readonly latestRunId: string | null;
};

const START_MY_DAY_TASK = /^majordome:.+:start-my-day$/;
const FIRST_LINE_MAX = 140;

/** True for the run a "Start my day" routine started (see `routineTaskId`). */
export function isStartMyDayTask(scheduledTaskId: string | undefined): boolean {
  return scheduledTaskId !== undefined && START_MY_DAY_TASK.test(scheduledTaskId);
}

/** The reply's first line of prose, without Markdown markers, short enough for a lock screen. */
export function firstReplyLine(text: string): string | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)*/, "")
      .replaceAll(/\*\*|__|`/g, "")
      .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .trim();
    if (line === "" || /^(?:-{3,}|\*{3,}|_{3,}|```.*)$/.test(line)) continue;
    return line.length > FIRST_LINE_MAX ? `${line.slice(0, FIRST_LINE_MAX - 1).trimEnd()}…` : line;
  }
  return null;
}

export function decideVaultPush(input: {
  readonly environmentId: EnvironmentId;
  readonly projectTitle: string;
  readonly thread: VaultPushThread;
  /** The finished run's reply, given only when that run came from "Start my day". */
  readonly startMyDayReply?: string | null;
}): VaultPush | null {
  const { thread } = input;
  const state = projectThreadAwarenessV2({
    environmentId: input.environmentId,
    project: { title: input.projectTitle },
    thread,
  });
  if (state === null) return null;
  const threadTitle = thread.title.trim() || "A run";
  switch (state.phase) {
    case "waiting_for_approval":
    case "waiting_for_input": {
      const requestId = thread.pendingRuntimeRequest?.id;
      if (requestId === undefined) return null;
      return {
        kind: "waiting",
        dedupeKey: `waiting:${thread.id}:${requestId}`,
        title: "Waiting for you",
        body:
          state.phase === "waiting_for_input"
            ? `${threadTitle} has a question.`
            : `${threadTitle} needs your OK.`,
        tag: `majordome:${thread.id}`,
        url: state.deepLink,
      };
    }
    case "failed":
      if (thread.latestRunId === null) return null;
      return {
        kind: "failed",
        dedupeKey: `failed:${thread.id}:${thread.latestRunId}`,
        title: "Couldn't finish",
        body: threadTitle,
        tag: `majordome:${thread.id}`,
        url: state.deepLink,
      };
    case "completed":
      if (input.startMyDayReply == null || thread.latestRunId === null) return null;
      return {
        kind: "start-my-day",
        dedupeKey: `done:${thread.id}:${thread.latestRunId}`,
        title: "Start my day",
        body: firstReplyLine(input.startMyDayReply) ?? "Your day is ready.",
        tag: `majordome:${thread.id}`,
        url: state.deepLink,
      };
    default:
      return null;
  }
}

/** A server still checking its providers after it starts looks blocked; it notifies only past this. */
export const ROUTINES_BLOCKED_GRACE_MS = 10 * 60 * 1_000;

/** A vault whose routines can't run here: since when, and whether the owner was told. */
export interface RoutinesBlockedWatch {
  readonly since: number;
  readonly notified: boolean;
}

/**
 * Notifies once per time a runner's routines stop being able to run, however often it is checked
 * and whichever provider reason it shows. Recovering forgets the watch, so a later failure notifies
 * again. Routines that are only not made yet say nothing: making them is this server's next step.
 */
export function decideRoutinesBlockedPush(input: {
  readonly previous: RoutinesBlockedWatch | undefined;
  readonly status: MajordomeRoutinesStatus;
  readonly now: number;
}): { readonly watch: RoutinesBlockedWatch | undefined; readonly notify: boolean } {
  if (input.status.ready || input.status.reason === "not-created") {
    return { watch: undefined, notify: false };
  }
  const since = input.previous?.since ?? input.now;
  if (input.previous?.notified) return { watch: input.previous, notify: false };
  const notify = input.now - since >= ROUTINES_BLOCKED_GRACE_MS;
  return { watch: { since, notified: notify }, notify };
}

export function routinesBlockedPush(input: {
  readonly status: MajordomeRoutinesStatus;
  readonly environmentId: EnvironmentId;
  /** The server's own name, as its clients show it. */
  readonly serverLabel: string;
}): VaultPushMessage {
  const provider = input.status.provider ?? "The AI your routines use";
  return {
    title: "Routines can't run",
    body:
      input.status.reason === "provider-signed-out"
        ? `${provider} is signed out on ${input.serverLabel}.`
        : input.status.reason === "provider-unavailable"
          ? `${provider} isn't available on ${input.serverLabel}.`
          : `No AI is signed in on ${input.serverLabel}.`,
    // One tag for the server: several vaults blocked by one provider show as one notification.
    tag: "majordome:routines",
    url: `/settings/providers?environmentId=${encodeURIComponent(input.environmentId)}`,
  };
}

/** Remembers the last few hundred keys; a run's notification goes out once per server start. */
export function makePushDedupe(capacity = 500) {
  const seen = new Set<string>();
  return (key: string): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > capacity) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  };
}
