import type { ThreadListV2Status } from "../features/threads/threadListV2";

/** What a chat wants from the owner, most pressing first. */
export type HomeNeed = "approval" | "answer" | "reply";

const NEED_ORDER: Readonly<Record<HomeNeed, number>> = { approval: 0, answer: 1, reply: 2 };

/** What a chat wants from the owner; null when it wants nothing. */
export function homeNeed(status: ThreadListV2Status, unread: boolean): HomeNeed | null {
  if (status === "approval") return "approval";
  if (status === "input" || status === "request") return "answer";
  return status === "ready" && unread ? "reply" : null;
}

/**
 * Whether home lists a chat. The Set-up chat is reached from Settings and stays out of the
 * list, new reply or not, except while it waits for an OK or an answer: that must not be missed.
 */
export function listedOnHome(setupChat: boolean, need: HomeNeed | null): boolean {
  return !setupChat || need === "approval" || need === "answer";
}

/**
 * What home's card says for the first chat that needs the owner; null draws it as an ordinary
 * row. A card always says what is asked: the request and its detail for an OK, the question for
 * an answer, the reply itself for a new reply. `request` is null while it cannot be read, and a
 * chat that is no topic carries no reply text.
 */
export function needsCardText(input: {
  readonly need: HomeNeed;
  readonly preview: string | null;
  readonly request: string | null;
  readonly detail?: string | null | undefined;
}): { readonly words: string; readonly detail: string | null } | null {
  const words = (input.need === "reply" ? input.preview : input.request)?.trim() ?? "";
  if (words === "") return null;
  // Only the first line of a detail: the chat shows all of it.
  const detail = input.need === "reply" ? "" : (input.detail?.trim().split("\n")[0]?.trim() ?? "");
  return { words, detail: detail === "" ? null : detail };
}

/**
 * Home's list with the chats that need the owner first: an OK before an answer before a new
 * reply, the latest first within each, then everything else in the order it came. `needOf`
 * answers null for a row that stays where it is. A row that `travelsWith` another, such as a
 * topic's other chat shown under it, stays right behind that row and is not counted.
 */
export function raiseNeedsYou<T>(
  items: ReadonlyArray<T>,
  needOf: (item: T) => { readonly need: HomeNeed; readonly at: string | null } | null,
  travelsWith: (item: T) => T | undefined = () => undefined,
): {
  readonly items: Array<T>;
  /** How many chats need the owner; they are the first rows, each with what travels with it. */
  readonly count: number;
  /** Where the rest of the list starts in `items`. */
  readonly restStart: number;
} {
  const raised: Array<{ readonly item: T; readonly order: number; readonly at: number }> = [];
  const rest: Array<T> = [];
  const behind = new Map<T, Array<T>>();
  for (const item of items) {
    const owner = travelsWith(item);
    if (owner !== undefined) {
      behind.set(owner, [...(behind.get(owner) ?? []), item]);
      continue;
    }
    const found = needOf(item);
    if (found === null) {
      rest.push(item);
      continue;
    }
    const at = Date.parse(found.at ?? "");
    raised.push({ item, order: NEED_ORDER[found.need], at: Number.isNaN(at) ? 0 : at });
  }
  raised.sort((left, right) => left.order - right.order || right.at - left.at);
  const withBehind = (item: T) => [item, ...(behind.get(item) ?? [])];
  const first = raised.flatMap((entry) => withBehind(entry.item));
  return {
    items: [...first, ...rest.flatMap(withBehind)],
    count: raised.length,
    restStart: first.length,
  };
}

/** The longest request home's card shows whole, with its two buttons. */
export const ONE_LINE_REQUEST = 90;

/**
 * True when an approval can be answered from home's card: it can still be answered, it is the
 * plain allow-or-not kind, and all there is to read about it fits one short line. Anything with
 * a warning, a reason or choices of its own is answered in the chat, where all of it shows.
 */
export function answersFromHome(approval: {
  readonly detail?: string | undefined;
  readonly reason?: string | undefined;
  readonly fullAccessOverride?: unknown;
  readonly options?: ReadonlyArray<unknown> | undefined;
  readonly responseCapability: string;
}): boolean {
  if (approval.responseCapability !== "live") return false;
  if (approval.reason || approval.fullAccessOverride !== undefined) return false;
  if (approval.options !== undefined && approval.options.length > 0) return false;
  const detail = approval.detail?.trim() ?? "";
  return !detail.includes("\n") && detail.length <= ONE_LINE_REQUEST;
}

/** Words typed in the ask box as one line of the journal; empty when there is nothing to keep. */
export function journalLine(words: string): string {
  // A pasted line break would start a second, untimed line in the note.
  return words.trim().replace(/\s*\n\s*/g, " ");
}

/** The "Needs you" label, with how many chats wait. */
export function needsYouLabel(count: number): string {
  return `Needs you · ${count}`;
}
