import {
  MAJORDOME_READING_KINDS,
  type MajordomeReadingItem,
  type MajordomeReadingKind,
} from "@t3tools/contracts";

export const READING_KIND_LABELS: Readonly<Record<MajordomeReadingKind, string>> = {
  article: "Articles",
  video: "Videos",
  paper: "Papers",
  repo: "Repos",
  podcast: "Podcasts",
  doc: "Docs",
  other: "Other",
};

export interface ReadingFilters {
  readonly kind: MajordomeReadingKind | null;
  readonly tag: string | null;
  readonly hideFinished: boolean;
}

const isFinished = (item: MajordomeReadingItem) => item.doneAt !== undefined;

/** Unfinished in the list's own order, then finished with the most recently finished first. */
export function orderReadingItems(
  items: ReadonlyArray<MajordomeReadingItem>,
): ReadonlyArray<MajordomeReadingItem> {
  const finished = items
    .filter(isFinished)
    .toSorted((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  return [...items.filter((item) => !isFinished(item)), ...finished];
}

export function filterReadingItems(
  items: ReadonlyArray<MajordomeReadingItem>,
  filters: ReadingFilters,
): ReadonlyArray<MajordomeReadingItem> {
  return items.filter(
    (item) =>
      (filters.kind === null || item.kind === filters.kind) &&
      (filters.tag === null || item.tags.includes(filters.tag)) &&
      !(filters.hideFinished && isFinished(item)),
  );
}

/** Whether rows can be dragged: with a kind or tag chosen, a drop would move rows that are hidden. */
export function canReorderReading(filters: ReadingFilters): boolean {
  return filters.kind === null && filters.tag === null;
}

export function presentReadingKinds(
  items: ReadonlyArray<MajordomeReadingItem>,
): ReadonlyArray<MajordomeReadingKind> {
  return MAJORDOME_READING_KINDS.filter((kind) => items.some((item) => item.kind === kind));
}

/** Every tag with how many saved things carry it, most used first. */
export function readingTagCounts(
  items: ReadonlyArray<MajordomeReadingItem>,
): ReadonlyArray<{ readonly tag: string; readonly count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of new Set(item.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .toSorted((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function durationWords(minutes: number): string {
  const whole = Math.max(1, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

const WATCHED_OR_HEARD: ReadonlySet<MajordomeReadingKind> = new Set(["video", "podcast"]);

/** "12 min read" for what is read, "18 min" for what is watched or heard; null without a length. */
export function readingLengthWords(
  item: Pick<MajordomeReadingItem, "kind" | "minutes">,
): string | null {
  if (item.minutes === undefined || !(item.minutes > 0)) return null;
  const words = durationWords(item.minutes);
  return WATCHED_OR_HEARD.has(item.kind) ? words : `${words} read`;
}

/** "6 h 9 min to go · 12 items" over the unfinished ones; null when nothing is left. */
export function readingTimeLeftWords(items: ReadonlyArray<MajordomeReadingItem>): string | null {
  const left = items.filter((item) => !isFinished(item));
  if (left.length === 0) return null;
  const minutes = left.reduce(
    (sum, item) => sum + (item.minutes !== undefined && item.minutes > 0 ? item.minutes : 0),
    0,
  );
  const count = `${left.length} ${left.length === 1 ? "item" : "items"}`;
  return minutes > 0 ? `${durationWords(minutes)} to go · ${count}` : count;
}

/**
 * Every id in its new order once `activeId` is dropped on `overId`. Only unfinished rows are
 * dragged, so finished ones keep their places in the list.
 */
export function placeReadingItem(
  items: ReadonlyArray<MajordomeReadingItem>,
  activeId: string,
  overId: string,
): ReadonlyArray<string> {
  const ids = items.map((item) => item.id);
  const unfinished = items.filter((item) => !isFinished(item)).map((item) => item.id);
  const from = unfinished.indexOf(activeId);
  const to = unfinished.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return ids;
  const moved = unfinished.filter((id) => id !== activeId);
  moved.splice(to, 0, activeId);
  let next = 0;
  return items.map((item) => (isFinished(item) ? item.id : (moved[next++] ?? item.id)));
}

const TAG_MAX_CHARS = 40;

/** The tags with one more, written as tags are kept; null when there is nothing new to add. */
export function withReadingTag(
  tags: ReadonlyArray<string>,
  typed: string,
): ReadonlyArray<string> | null {
  const tag = typed.trim().replace(/^#+/, "").trim().toLowerCase().slice(0, TAG_MAX_CHARS);
  return tag === "" || tags.includes(tag) ? null : [...tags, tag];
}

/** The minutes typed in "Change length": null forgets the length, undefined is not a length. */
export function parseReadingMinutes(typed: string): number | null | undefined {
  const text = typed.trim();
  if (text === "") return null;
  const minutes = Number(text);
  return Number.isInteger(minutes) && minutes > 0 && minutes <= 6000 ? minutes : undefined;
}

/** "Nov 6", with the year once it is not this one. */
export function readingAddedWords(addedAt: string, now: Date): string {
  const added = new Date(addedAt);
  if (Number.isNaN(added.getTime())) return "";
  return added.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(added.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** What "Ask the assistant about this" puts in the assistant's text box. */
export function askAboutReadingMessage(
  item: Pick<MajordomeReadingItem, "title" | "url" | "doneAt">,
): string {
  const about = `About “${item.title}” on my reading list${item.url === null ? "" : ` (${item.url})`}`;
  return item.doneAt === undefined
    ? `${about}: tell me in a few lines what it covers and whether it is worth my time.`
    : `${about}: quiz me on it with three short questions, then save what I want to remember as its note.`;
}
