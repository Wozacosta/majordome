import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScreenContextRecord } from "@t3tools/contracts";
import {
  sanitizeComposerContextLabel,
  toComposerContextId,
} from "@t3tools/shared/composerContextReferences";

import { SETTINGS_SECTION_LABELS } from "../settings/settingsSearch";

const SCREENS: Readonly<Record<string, string>> = {
  "/": "Today",
  "/feed": "Feed",
  "/reading": "Reading list",
  "/chats": "Chats",
  "/reminders": "Reminders",
  "/routines": "Routines",
  "/todos": "To-dos",
  "/usage": "Usage",
  "/settings/connectors": "Connections",
};

const SETTINGS_LABELS: Readonly<Record<string, string>> = SETTINGS_SECTION_LABELS;
const SCREEN_MAX_CHARS = 2_048;

/**
 * The screen at a location, as the person would name it; null where the app has no screen of its
 * own to name, such as a conversation.
 */
export function assistantScreenName(location: {
  readonly pathname: string;
  readonly search?: Readonly<Record<string, unknown>>;
}): string | null {
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/notes") {
    const path = location.search?.path;
    return typeof path === "string" && path.trim() !== ""
      ? `Notes, reading the note "${path.trim()}"`
      : "Notes";
  }
  const screen = SCREENS[pathname];
  if (screen !== undefined) return screen;
  if (pathname !== "/settings" && !pathname.startsWith("/settings/")) return null;
  const label = SETTINGS_LABELS[pathname];
  return label === undefined ? "Settings" : `Settings, ${label}`;
}

/**
 * The one quiet line under the assistant panel's name: what it can be asked about here. It names
 * the page the owner is on in a word or two, never its whole path.
 */
export function assistantIntro(location: {
  readonly pathname: string;
  readonly search?: Readonly<Record<string, unknown>>;
}): string {
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const path = location.search?.path;
  const about =
    pathname === "/notes"
      ? typeof path === "string" && path.trim() !== ""
        ? "this note"
        : "your notes"
      : (SETTINGS_LABELS[pathname] ?? SCREENS[pathname] ?? null);
  return about === null
    ? "Ask anything, or say what to change."
    : `Ask about ${about}, or say what to change.`;
}

/** One per message, never referenced in its text. */
export function screenContextRecord(screen: string): ScreenContextRecord {
  return {
    version: 1,
    kind: "screen",
    contextId: toComposerContextId("screen"),
    label: sanitizeComposerContextLabel(screen, "screen"),
    screen: screen.slice(0, SCREEN_MAX_CHARS),
  };
}

const STALE_ASSISTANT_CONVERSATION_MS = 3 * 24 * 60 * 60 * 1000;

/** Whether the assistant's conversation is old enough, and quiet enough, to start a fresh one. */
export function isAssistantConversationStale(input: {
  /** ISO time of the last thing said or done in it; null while nothing has been. */
  readonly lastActivityAt: string | null;
  readonly now: number;
  /** A run in progress, or something waiting on the person. */
  readonly busy: boolean;
}): boolean {
  if (input.busy || input.lastActivityAt === null) return false;
  const last = Date.parse(input.lastActivityAt);
  return Number.isFinite(last) && input.now - last > STALE_ASSISTANT_CONVERSATION_MS;
}

type AssistantShell = Pick<
  EnvironmentThreadShell,
  | "latestRun"
  | "runtime"
  | "latestUserMessageAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "pendingBackgroundTasks"
>;

/** What `isAssistantConversationStale` needs to know about the conversation. */
export function assistantConversationActivity(shell: AssistantShell): {
  readonly lastActivityAt: string | null;
  readonly busy: boolean;
} {
  const status = shell.runtime?.status ?? "idle";
  const times = [
    shell.latestUserMessageAt,
    shell.latestRun?.requestedAt,
    shell.latestRun?.startedAt,
    shell.latestRun?.completedAt,
  ].filter((time) => typeof time === "string");
  return {
    // An empty conversation is already a fresh one.
    lastActivityAt: times.reduce<string | null>(
      (latest, time) => (latest === null || Date.parse(time) > Date.parse(latest) ? time : latest),
      null,
    ),
    busy:
      status === "queued" ||
      status === "preparing" ||
      status === "starting" ||
      status === "running" ||
      status === "waiting" ||
      shell.hasPendingApprovals ||
      shell.hasPendingUserInput ||
      shell.hasActionableProposedPlan ||
      shell.pendingBackgroundTasks.length > 0,
  };
}
