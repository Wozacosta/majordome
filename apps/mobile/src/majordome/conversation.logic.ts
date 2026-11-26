import { SHOW_SETUP_LABEL } from "@t3tools/shared/majordome";

/** A file as a person names it: "Notes/Taxes 2026.md" is "Taxes 2026". */
export function noteName(path: string): string {
  const base =
    path
      .trim()
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "";
  return base.replace(/\.(md|markdown)$/i, "");
}

/** What a step is, as upstream's work log classifies it (`toolGroupAction`). */
export type ActivityKind =
  | "read"
  | "edit"
  | "code-search"
  | "search"
  | "browser"
  | "command"
  | "device"
  | "thread-create"
  | "other"
  | "update"
  | (string & {});

export type ActivityState = "working" | "done" | "failed";

interface ActivityWords {
  readonly working: string;
  readonly done: string;
  readonly failed: string;
}

/** `{name}` is the note, or "a note" when the step does not say which. */
const ACTIVITY_WORDS: Readonly<Record<string, ActivityWords>> = {
  read: { working: "Reading {name}", done: "Read {name}", failed: "Couldn't read {name}" },
  edit: { working: "Writing {name}", done: "Updated {name}", failed: "Couldn't change {name}" },
  "code-search": {
    working: "Searching your notes",
    done: "Searched your notes",
    failed: "Couldn't search your notes",
  },
  search: {
    working: "Looking on the web",
    done: "Looked on the web",
    failed: "Couldn't look on the web",
  },
  browser: {
    working: "Opening a web page",
    done: "Opened a web page",
    failed: "Couldn't open a web page",
  },
  "thread-create": {
    working: "Starting another chat",
    done: "Started another chat",
    failed: "Couldn't start another chat",
  },
};

const OTHER_WORDS: ActivityWords = {
  working: "Working…",
  done: "Finished a step",
  failed: "A step didn't work",
};

// Upstream's item types that are a step the assistant takes. The rest keep upstream's words:
// notices, requests, and thoughts, whose own first line already reads plainly.
const STEP_ITEM_TYPES = new Set([
  "command_execution",
  "dynamic_tool",
  "file_change",
  "file_search",
  "web_search",
  "thread_created",
]);

function named(paths: ReadonlyArray<string>): string {
  const names = paths.map(noteName).filter((name) => name !== "");
  const [first] = names;
  if (first === undefined) return "a note";
  return names.length === 1 ? first : `${first} and ${names.length - 1} more`;
}

/**
 * One step the assistant takes, in plain words. The command, tool name and full path stay in the
 * row's detail, which opens on tap.
 */
export function activityInPlainWords(input: {
  readonly kind: ActivityKind;
  readonly state: ActivityState;
  /** Files the step touched, when it names them. */
  readonly paths?: ReadonlyArray<string>;
  /** A sentence upstream already wrote for one of its own tools, such as "Created a routine". */
  readonly sentence?: string | null | undefined;
  /** The outside service a tool belongs to, such as "Gmail". */
  readonly service?: string | null | undefined;
  /** Upstream's item type, when known. */
  readonly itemType?: string | undefined;
  /** Upstream's own text, kept for notices and requests, which are not steps. */
  readonly fallback?: string;
}): string {
  if (input.fallback && input.itemType !== undefined && !STEP_ITEM_TYPES.has(input.itemType)) {
    return input.fallback;
  }
  if (input.sentence) return input.sentence;
  if (input.service) {
    return input.state === "working"
      ? `Using ${input.service}`
      : input.state === "failed"
        ? `Couldn't use ${input.service}`
        : `Used ${input.service}`;
  }
  if (input.kind === "update" && input.fallback) return input.fallback;
  const words = ACTIVITY_WORDS[input.kind] ?? OTHER_WORDS;
  return words[input.state].replace("{name}", named(input.paths ?? []));
}

export type ApprovalKind =
  | "command"
  | "file-read"
  | "file-change"
  | "mcp-elicitation"
  | "permission"
  | (string & {});

// A file path somewhere in what the provider asked. A path from the root may hold spaces, so it
// runs to the last file ending on its line; otherwise the last word that ends like a file name.
function pathIn(detail: string | undefined): string | null {
  if (!detail) return null;
  const rooted = detail.match(
    /(?:^|\s)((?:~|[A-Za-z]:)?[\\/][^\n"'`]*\.[A-Za-z0-9]{1,8})(?=$|[\s"'`()<>:,.])/m,
  );
  if (rooted?.[1]) return rooted[1];
  const words = detail.match(/[^\s"'`()<>:,]+\.[A-Za-z0-9]{1,8}(?=$|[\s"'`()<>:,])/g);
  return words?.pop() ?? null;
}

/** What Majordome is asking leave for, as one question. */
export function approvalQuestion(input: {
  readonly kind: ApprovalKind;
  readonly detail?: string | undefined;
  readonly appName?: string | undefined;
}): string {
  if (input.appName) return `Majordome wants to use ${input.appName}. Allow?`;
  const path = pathIn(input.detail);
  const name = path === null ? "" : noteName(path);
  switch (input.kind) {
    case "file-change":
      return `Majordome wants to change ${name || "a note"}. Allow?`;
    case "file-read":
      return `Majordome wants to read ${name || "a file"}. Allow?`;
    case "command":
      return "Majordome wants to run a command on your computer. Allow?";
    default:
      return "Majordome needs your OK to go on. Allow?";
  }
}

export interface ApprovalChoice<Decision extends string> {
  readonly decision: Decision;
  readonly label: string;
  readonly warning?: string | undefined;
}

const APPROVAL_LABELS: Readonly<Record<string, string>> = {
  accept: "Allow",
  acceptForSession: "Allow for the rest of this chat",
  acceptAlways: "Always allow",
  decline: "Don't allow",
  cancel: "Stop",
};

/**
 * The buttons under an approval. The AI account's own choices keep their words, since they can
 * say more than "allow"; ours are used when it offers none. Refusing is always offered.
 */
export function approvalChoices<Decision extends string>(
  offered: ReadonlyArray<ApprovalChoice<Decision>> | undefined,
  decline: Decision,
): ReadonlyArray<ApprovalChoice<Decision>> {
  const plain = (decision: string) => APPROVAL_LABELS[decision] ?? decision;
  if (offered === undefined || offered.length === 0) {
    return [
      { decision: "accept" as Decision, label: plain("accept") },
      { decision: "acceptForSession" as Decision, label: plain("acceptForSession") },
      { decision: decline, label: plain(decline) },
    ];
  }
  const refuses = offered.some(
    (choice) => choice.decision === decline || choice.decision === "cancel",
  );
  return refuses ? offered : [...offered, { decision: decline, label: plain(decline) }];
}

export type FailureClass =
  | "usage_limit"
  | "provider_error"
  | "transport_error"
  | "permission_error"
  | "validation_error"
  | "unknown"
  | (string & {});

const SIGNED_OUT =
  /\b(log ?in|sign ?in|signed out|logged out|unauthori[sz]ed|authenticat|401|api key|credential)/i;

const FAILURE_WORDS: Readonly<Record<string, string>> = {
  usage_limit: "Your AI account has reached its limit. Try again later.",
  provider_error: "The AI ran into a problem. Send your message again.",
  transport_error: "The link to the AI dropped. Send your message again.",
  permission_error: "The AI account refused this. Check on your computer that it is signed in.",
  validation_error: "The AI couldn't take that message. Try wording it another way.",
};

/** Why a reply stopped, as one sentence that ends with what to do. */
export function failureInPlainWords(failure: {
  readonly class: FailureClass;
  readonly message: string;
}): string {
  if (failure.class !== "usage_limit" && SIGNED_OUT.test(failure.message)) {
    return "Your AI account isn't signed in. Sign in on your computer, in Settings under AI accounts.";
  }
  return FAILURE_WORDS[failure.class] ?? "Something went wrong. Send your message again.";
}

export type ConnectionProblem = "offline" | "unsupported" | "error" | "available";

/** Why the computer can't be reached: short enough for the one-line pill, which retries on tap. */
export function connectionProblemInPlainWords(
  problem: ConnectionProblem,
  computerLabel: string | null,
): string {
  const computer = computerLabel?.trim() || "your computer";
  switch (problem) {
    case "offline":
      return "You're offline. Tap to retry.";
    case "unsupported":
      return "Update this app to connect.";
    case "error":
      return `Can't reach ${computer}. Tap to retry.`;
    case "available":
      return "Not connected. Tap to connect.";
  }
}

/** What the message box invites, by what the chat is waiting for. */
export function composerPlaceholder(input: {
  readonly waitsForApproval: boolean;
  readonly working: boolean;
}): string {
  if (input.waitsForApproval) return "Or say what to do instead";
  return input.working ? "Add something while Majordome works" : "Ask Majordome anything";
}

export type ConversationMenuAction =
  | "rename"
  | "show-setup"
  | "mark-done"
  | "bring-back"
  | "delete";

export interface ConversationMenuEntry {
  readonly id: ConversationMenuAction;
  readonly title: string;
  readonly icon: string;
  readonly destructive?: boolean;
}

/** The chat's own menu: a chat marked as done offers the way back in place of the way in. */
export function conversationMenu(input: {
  readonly done: boolean;
  readonly canMarkDone: boolean;
}): ReadonlyArray<ConversationMenuEntry> {
  const entries: Array<ConversationMenuEntry> = [
    { id: "rename", title: "Rename", icon: "pencil" },
    {
      id: "show-setup",
      title: SHOW_SETUP_LABEL,
      icon: "point.3.connected.trianglepath.dotted",
    },
  ];
  if (input.done) {
    entries.push({ id: "bring-back", title: "Bring back", icon: "arrow.uturn.backward" });
  } else if (input.canMarkDone) {
    entries.push({ id: "mark-done", title: "Mark as done", icon: "checkmark" });
  }
  entries.push({ id: "delete", title: "Delete", icon: "trash", destructive: true });
  return entries;
}

/** The model list's own words: it answers one question, which AI replies in this chat. */
export const MODEL_PICKER_WORDS = {
  title: "Which AI",
  close: "Close",
  options: "How it answers",
} as const;
