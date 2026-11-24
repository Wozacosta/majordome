import type { MajordomeKeyFact, MajordomeKeyFactKind } from "@t3tools/contracts";

const KEY_FACT_GROUPS: ReadonlyArray<{
  readonly kind: MajordomeKeyFactKind;
  readonly title: string;
}> = [
  { kind: "date", title: "Dates" },
  { kind: "link", title: "Links" },
  { kind: "place", title: "Places" },
  { kind: "person", title: "Names" },
];

export interface KeyFactRow {
  readonly key: string;
  readonly kind: MajordomeKeyFactKind;
  /** What the row says first: the fact, or for a link what it is. */
  readonly label: string;
  /** The line under it; null when there is nothing more to say. */
  readonly detail: string | null;
  /** The address a link row opens. */
  readonly href: string | null;
  /** What copying the row gives. */
  readonly value: string;
}

/** A web address as a reader says it: the site, then the page when there is one. */
function shortAddress(address: string): string {
  try {
    const url = new URL(address);
    const page = url.pathname.replace(/\/$/, "");
    return `${url.host.replace(/^www\./, "")}${page}`;
  } catch {
    return address;
  }
}

/** A date the server wrote as YYYY-MM-DD, with or without a time, as a reader says it. */
function readableDate(value: string, locale: string | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(value);
  if (match === null) return value;
  const day = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return match[4] === undefined ? day : `${day}, ${match[4]}`;
}

/** The owner's own day, as the server writes one. */
export const localDay = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

const dayOf = (value: string) => /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? null;

/** Rows the chat's panel shows; the rest are a click away, beside the chat. */
const FIRST_ROWS = 3;
const EARLIER = "Earlier";

export interface KeyFactGroup {
  readonly title: string;
  readonly rows: ReadonlyArray<KeyFactRow>;
}

/**
 * A conversation's key facts in full: what is coming first (dates, soonest first), then links,
 * places and names, newest first, and last the days that are over.
 */
export function keyFactGroups(
  facts: ReadonlyArray<MajordomeKeyFact>,
  options: { readonly today?: string; readonly locale?: string } = {},
): ReadonlyArray<KeyFactGroup> {
  const { today, locale } = options;
  const row = (fact: MajordomeKeyFact): KeyFactRow => {
    const note = fact.note ?? null;
    const link = fact.kind === "link";
    const value = fact.kind === "date" ? readableDate(fact.value, locale) : fact.value;
    return {
      key: `${fact.kind}:${fact.value}`,
      kind: fact.kind,
      label: link ? (note ?? shortAddress(fact.value)) : value,
      detail: link ? (note === null ? null : shortAddress(fact.value)) : note,
      href: link ? fact.value : null,
      value,
    };
  };
  const over = (fact: MajordomeKeyFact) => {
    const day = fact.kind === "date" ? dayOf(fact.value) : null;
    return today !== undefined && day !== null && day < today;
  };
  const groups = KEY_FACT_GROUPS.map(({ kind, title }) => {
    const ofKind = facts.filter((fact) => fact.kind === kind && !over(fact)).toReversed();
    const ordered =
      kind === "date"
        ? ofKind.toSorted((a, b) =>
            dayOf(a.value) === null || dayOf(b.value) === null
              ? Number(dayOf(a.value) === null) - Number(dayOf(b.value) === null)
              : a.value.localeCompare(b.value),
          )
        : ofKind;
    return { title, rows: ordered.map(row) };
  });
  const earlier = facts.filter(over).toSorted((a, b) => b.value.localeCompare(a.value));
  return [...groups, { title: EARLIER, rows: earlier.map(row) }].filter(
    (group) => group.rows.length > 0,
  );
}

/** The few rows the chat's panel shows, what is coming before the rest, and how many it leaves out. */
export function firstKeyFacts(groups: ReadonlyArray<KeyFactGroup>): {
  readonly rows: ReadonlyArray<KeyFactRow>;
  readonly remaining: number;
} {
  const total = groups.reduce((count, group) => count + group.rows.length, 0);
  const rows = groups
    .filter((group) => group.title !== EARLIER)
    .flatMap((group) => group.rows)
    .slice(0, FIRST_ROWS);
  return { rows, remaining: total - rows.length };
}

/** The groups cut down to the rows that hold what was typed, in any of their words. */
export function searchKeyFacts(
  groups: ReadonlyArray<KeyFactGroup>,
  typed: string,
): ReadonlyArray<KeyFactGroup> {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups
    .map((group) => ({
      title: group.title,
      rows: group.rows.filter((row) => {
        const text = `${row.label} ${row.detail ?? ""} ${row.value}`.toLowerCase();
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((group) => group.rows.length > 0);
}
