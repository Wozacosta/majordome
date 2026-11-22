import type { MajordomeKeyFact, MajordomeKeyFactKind } from "@t3tools/contracts";

const KEY_FACT_GROUPS: ReadonlyArray<{
  readonly kind: MajordomeKeyFactKind;
  readonly title: string;
}> = [
  { kind: "link", title: "Links" },
  { kind: "place", title: "Places" },
  { kind: "date", title: "Dates" },
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

/** A conversation's key facts as the panel lists them: by kind, each kind newest first. */
export function keyFactGroups(
  facts: ReadonlyArray<MajordomeKeyFact>,
  locale?: string,
): ReadonlyArray<{ readonly title: string; readonly rows: ReadonlyArray<KeyFactRow> }> {
  return KEY_FACT_GROUPS.flatMap(({ kind, title }) => {
    const rows = facts
      .filter((fact) => fact.kind === kind)
      .toReversed()
      .map((fact): KeyFactRow => {
        const note = fact.note ?? null;
        const link = kind === "link";
        const value = kind === "date" ? readableDate(fact.value, locale) : fact.value;
        return {
          key: `${kind}:${fact.value}`,
          kind,
          label: link ? (note ?? shortAddress(fact.value)) : value,
          detail: link ? (note === null ? null : shortAddress(fact.value)) : note,
          href: link ? fact.value : null,
          value,
        };
      });
    return rows.length === 0 ? [] : [{ title, rows }];
  });
}
