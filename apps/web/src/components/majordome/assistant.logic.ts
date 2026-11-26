import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScreenContextRecord } from "@t3tools/contracts";
import { parseAppScreenHref } from "@t3tools/shared/appScreenLinks";
import {
  sanitizeComposerContextLabel,
  toComposerContextId,
} from "@t3tools/shared/composerContextReferences";

import { msg } from "gt-react";

import { FEED_NAME } from "./feed.logic";
import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_SECTION_LABELS,
  type SettingsPath,
} from "../settings/settingsSearch";

const LINKED_SCREENS = {
  "/feed": FEED_NAME,
  "/reading": "Reading list",
  "/library": "Library",
  "/chats": "Chats",
  "/reminders": "Reminders",
  "/routines": "Routines",
  "/todos": "To-dos",
  "/usage": "Usage",
  "/notes": "Notes",
} as const;

const SCREENS: Readonly<Record<string, string>> = {
  ...LINKED_SCREENS,
  "/": "Today",
  "/settings/connectors": "Connections",
};

const names = <Path extends string>(
  screens: Readonly<Record<Path, string>>,
  pathname: string,
): pathname is Path => Object.hasOwn(screens, pathname);

/**
 * The screen an assistant's `app://` link opens, with the app's own name for it; null when the
 * link is no such link or names a screen this app does not have.
 */
export function appScreenLinkTarget(
  href: string,
): { readonly to: SettingsPath | keyof typeof LINKED_SCREENS; readonly label: string } | null {
  const pathname = parseAppScreenHref(href);
  if (pathname === null) return null;
  if (names(SETTINGS_SECTION_LABELS, pathname)) {
    return { to: pathname, label: SETTINGS_SECTION_LABELS[pathname] };
  }
  return names(LINKED_SCREENS, pathname) ? { to: pathname, label: LINKED_SCREENS[pathname] } : null;
}

const SETTINGS_WORD = msg("Settings");

type ScreenTarget = NonNullable<ReturnType<typeof appScreenLinkTarget>>;

// Names too plain to link on their own ("Notes", "Chats", "Usage") are left out.
const NAMED_SCREENS: ReadonlyArray<ScreenTarget> = (
  ["/routines", "/reminders", "/todos", "/reading", "/feed"] as const
).map((to) => ({ to, label: LINKED_SCREENS[to] }));

const NAMED_SETTINGS: ReadonlyArray<ScreenTarget> = [
  ...SETTINGS_NAV_GROUPS.flatMap((group) => group.paths).map((to) => ({
    to,
    label: SETTINGS_SECTION_LABELS[to],
  })),
  // What conversations begun before the page was renamed still call it.
  { to: "/settings/always-on", label: "Your server" },
];

/**
 * The screen a name set in bold in an assistant's message stands for. An assistant that was not
 * told to link screens, or forgot, still writes "open **Phone & notifications**". A page of
 * Settings counts only where the message speaks of Settings, since "General" or "Status" in bold
 * is otherwise an ordinary word.
 */
export function namedScreenTarget(
  name: string,
  message: string | null,
  translate: (text: string) => string = (text) => text,
): ScreenTarget | null {
  const named = (screens: ReadonlyArray<ScreenTarget>) =>
    screens.find((screen) => screen.label === name || translate(screen.label) === name) ?? null;
  const screen = named(NAMED_SCREENS);
  if (screen !== null) return screen;
  const setting = named(NAMED_SETTINGS);
  if (setting === null || message === null) return setting;
  return message.includes("Settings") || message.includes(translate(SETTINGS_WORD))
    ? setting
    : null;
}

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
