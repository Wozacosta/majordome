import {
  MAJORDOME_READING_KINDS,
  type MajordomeReadingItem,
  type MajordomeReadingKind,
  type MajordomeReadingSubject,
} from "@t3tools/contracts";

export const READING_KIND_LABELS: Readonly<Record<MajordomeReadingKind, string>> = {
  article: "Articles",
  video: "Videos",
  paper: "Papers",
  repo: "Code",
  podcast: "Podcasts",
  doc: "Documents",
  other: "Other",
};

/** One of a kind, for choosing what a saved thing is. */
export const READING_KIND_NAMES: Readonly<Record<MajordomeReadingKind, string>> = {
  article: "Article",
  video: "Video",
  paper: "Paper",
  repo: "Code",
  podcast: "Podcast",
  doc: "Document",
  other: "Other",
};

/** The filter for what is filed under no subject. */
export const NO_SUBJECT = "none";

export interface ReadingFilters {
  readonly kind: MajordomeReadingKind | null;
  readonly tag: string | null;
  readonly hideFinished: boolean;
  /** A subject's id, `NO_SUBJECT`, or nothing for every subject. */
  readonly subject?: string | null;
}

/** The subject an item is filed under; one that no longer exists counts as none. */
export function readingSubjectOf(
  item: Pick<MajordomeReadingItem, "subjectId">,
  subjects: ReadonlyArray<MajordomeReadingSubject>,
): MajordomeReadingSubject | undefined {
  return subjects.find((subject) => subject.id === item.subjectId);
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
      (filters.subject == null ||
        (filters.subject === NO_SUBJECT
          ? item.subjectId === undefined
          : item.subjectId === filters.subject)) &&
      !(filters.hideFinished && isFinished(item)),
  );
}

/**
 * Whether rows can be dragged: with a kind, a tag, a subject or a search narrowing the list, a
 * drop would move rows that are hidden.
 */
export function canReorderReading(filters: ReadingFilters, query = ""): boolean {
  return (
    filters.kind === null && filters.tag === null && filters.subject == null && query.trim() === ""
  );
}

/** The list without what is in the Trash, and the Trash with the last removed first. */
export function splitTrashedReading(items: ReadonlyArray<MajordomeReadingItem>): {
  readonly kept: ReadonlyArray<MajordomeReadingItem>;
  readonly trashed: ReadonlyArray<MajordomeReadingItem>;
} {
  return {
    kept: items.filter((item) => item.deletedAt === undefined),
    trashed: items
      .filter((item) => item.deletedAt !== undefined)
      .toSorted((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "")),
  };
}

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** The items that hold every word typed, anywhere in what a row says; case and accents ignored. */
export function searchReadingItems(
  items: ReadonlyArray<MajordomeReadingItem>,
  query: string,
): ReadonlyArray<MajordomeReadingItem> {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const text = plain(
      [item.title, item.site, item.url, item.summary, item.notes, item.why, item.progress]
        .concat(item.tags)
        .join(" "),
    );
    return words.every((word) => text.includes(word));
  });
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

/** How many of the first unfinished things the Next view shows. */
const READING_NEXT_COUNT = 3;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** When a snooze ends: the start of that day here, or the moment itself if a time was written. */
function wakeTime(snoozedUntil: string): Date {
  const day = CALENDAR_DATE.exec(snoozedUntil.trim());
  return day === null
    ? new Date(snoozedUntil)
    : new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
}

/** True while an unfinished item waits for its day; a day that has come no longer hides it. */
export function isReadingSnoozed(
  item: Pick<MajordomeReadingItem, "doneAt" | "snoozedUntil">,
  now: Date,
): boolean {
  if (item.doneAt !== undefined || item.snoozedUntil === undefined) return false;
  return wakeTime(item.snoozedUntil).getTime() > now.getTime();
}

/** The list without what is snoozed, and the snoozed ones with the soonest back first. */
export function splitSnoozedReading(
  items: ReadonlyArray<MajordomeReadingItem>,
  now: Date,
): {
  readonly awake: ReadonlyArray<MajordomeReadingItem>;
  readonly snoozed: ReadonlyArray<MajordomeReadingItem>;
} {
  const snoozed = items.filter((item) => isReadingSnoozed(item, now));
  return {
    awake: items.filter((item) => !snoozed.includes(item)),
    snoozed: snoozed.toSorted(
      (a, b) => wakeTime(a.snoozedUntil ?? "").getTime() - wakeTime(b.snoozedUntil ?? "").getTime(),
    ),
  };
}

const openReadingItems = (items: ReadonlyArray<MajordomeReadingItem>, now: Date) =>
  items.filter(
    (item) => !isFinished(item) && !isReadingSnoozed(item, now) && item.deletedAt === undefined,
  );

/**
 * What to do next, and the unfinished ones after. With subjects in focus it is the top item of
 * each, in the subjects' order, then anything already started elsewhere. Without, or when none
 * of them has anything left, it is the first few of the list.
 */
export function nextReadingItems(
  items: ReadonlyArray<MajordomeReadingItem>,
  now: Date,
  subjects: ReadonlyArray<MajordomeReadingSubject> = [],
): {
  readonly next: ReadonlyArray<MajordomeReadingItem>;
  readonly later: ReadonlyArray<MajordomeReadingItem>;
} {
  const open = openReadingItems(items, now);
  const tops = subjects
    .filter((subject) => subject.focus === true)
    .flatMap((subject) => open.find((item) => item.subjectId === subject.id) ?? []);
  const next =
    tops.length === 0
      ? open.slice(0, READING_NEXT_COUNT)
      : [...tops, ...open.filter((item) => item.progress !== undefined && !tops.includes(item))];
  return { next, later: open.filter((item) => !next.includes(item)) };
}

/** What the Next view says it is showing; null without subjects, when there is nothing to choose. */
export function readingFocusWords(
  items: ReadonlyArray<MajordomeReadingItem>,
  now: Date,
  subjects: ReadonlyArray<MajordomeReadingSubject>,
): string | null {
  if (subjects.length === 0) return null;
  const focused = subjects.filter((subject) => subject.focus === true);
  if (focused.length === 0) return "No subject is in focus, so this is the top of your whole list.";
  const names = focused.map((subject) => subject.name).join(", ");
  const open = openReadingItems(items, now);
  return focused.some((subject) => open.some((item) => item.subjectId === subject.id))
    ? `Showing the top of: ${names}`
    : `Nothing left in ${names}, so this is the top of your whole list.`;
}

/** "12 more on your list · 5 h 24 min" for what comes after the Next ones; null for none. */
export function readingMoreWords(later: ReadonlyArray<MajordomeReadingItem>): string | null {
  if (later.length === 0) return null;
  const minutes = later.reduce(
    (sum, item) => sum + (item.minutes !== undefined && item.minutes > 0 ? item.minutes : 0),
    0,
  );
  const count = `${later.length} more on your list`;
  return minutes > 0 ? `${count} · ${durationWords(minutes)}` : count;
}

export type ReadingSnoozeChoice = "tomorrow" | "week" | "month";

/** The day a snooze ends, as it is saved: `2026-12-02`, counted in this device's own time. */
export function readingSnoozeDate(choice: ReadingSnoozeChoice, now: Date): string {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const until =
    choice === "tomorrow"
      ? new Date(year, month, day + 1)
      : choice === "week"
        ? new Date(year, month, day + 7)
        : // Jan 31 comes back on the last day of February, not in March.
          new Date(year, month + 1, Math.min(day, new Date(year, month + 2, 0).getDate()));
  const two = (value: number) => String(value).padStart(2, "0");
  return `${until.getFullYear()}-${two(until.getMonth() + 1)}-${two(until.getDate())}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "back on Tue 2 Dec", with the year once it is not this one. */
export function readingBackOnWords(snoozedUntil: string, now: Date): string {
  const back = wakeTime(snoozedUntil);
  if (Number.isNaN(back.getTime())) return "";
  const year = back.getFullYear() === now.getFullYear() ? "" : ` ${back.getFullYear()}`;
  return `back on ${WEEKDAYS[back.getDay()]} ${back.getDate()} ${MONTHS[back.getMonth()]}${year}`;
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
