// @effect-diagnostics globalDate:off -- When a key was last used is said in the reader's own locale via Intl.
import { isCalendarDay, type MajordomeSavedKey } from "@t3tools/contracts";

/** How long before its last day a key is said to be ending soon. */
const ENDING_SOON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The last day a key works, from what the owner typed: a day (`2027-11-25`, `25/11/2027`) or how
 * long it lasts from today (`1 year`, `6 months`, `90 days`). Null when it is neither, or the day
 * does not exist.
 */
export function savedKeyDayFrom(typed: string, nowMs: number): string | null {
  const text = typed.trim().toLowerCase();
  const slashed = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text);
  const day =
    slashed === null
      ? text
      : `${slashed[3]}-${slashed[2]?.padStart(2, "0")}-${slashed[1]?.padStart(2, "0")}`;
  if (isCalendarDay(day)) return day;
  const lasting = /^(\d{1,3})\s*(day|week|month|year)s?$/.exec(text);
  if (lasting === null) return null;
  const count = Number(lasting[1]);
  const end = new Date(nowMs);
  if (lasting[2] === "day") end.setUTCDate(end.getUTCDate() + count);
  else if (lasting[2] === "week") end.setUTCDate(end.getUTCDate() + count * 7);
  else {
    // Counted on the first of the month, so 31 Jan plus a month is not pushed into March.
    const date = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + count * (lasting[2] === "year" ? 12 : 1));
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(date, last));
  }
  return count === 0 ? null : dayOf(end.getTime());
}

/** Where a key stands against its last day: none said, still good, ending within a month, or past it. */
export function savedKeyStanding(
  key: Pick<MajordomeSavedKey, "expiresOn">,
  nowMs: number,
): "open" | "good" | "soon" | "over" {
  if (key.expiresOn === undefined) return "open";
  if (key.expiresOn < dayOf(nowMs)) return "over";
  return key.expiresOn <= dayOf(nowMs + ENDING_SOON_DAYS * DAY_MS) ? "soon" : "good";
}

/** "Works until 25 Nov 2027", or "Stopped working 25 Nov 2026" once that day is past. */
export function savedKeyExpiryLine(
  key: Pick<MajordomeSavedKey, "expiresOn">,
  nowMs: number,
  locale?: string,
): string | null {
  if (key.expiresOn === undefined) return null;
  const day = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${key.expiresOn}T00:00:00Z`));
  return savedKeyStanding(key, nowMs) === "over" ? `Stopped working ${day}` : `Works until ${day}`;
}

/**
 * The name a key is saved under, from what the owner typed: "Garmin API" becomes `garmin-api`.
 * Empty when nothing usable was typed. The server names keys the way a command line can type them.
 */
export function savedKeyNameFrom(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 128);
}

/**
 * The line under a key's name: what it is for, the secret source it is kept in, its last day
 * when `nowMs` is given, and when the assistant last took it. A key a source signs in with says so instead: it is never taken.
 */
export function savedKeyLine(
  key: Pick<MajordomeSavedKey, "note" | "lastUsedAt" | "source" | "signsInTo" | "expiresOn">,
  locale?: string,
  timeZone?: string,
  nowMs?: number,
): string {
  const used =
    key.lastUsedAt === undefined
      ? "Not used yet"
      : `Last used ${new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          year: "numeric",
          ...(timeZone === undefined ? {} : { timeZone }),
        }).format(new Date(key.lastUsedAt))}`;
  if (key.signsInTo !== undefined) {
    return `Signs Majordome in to ${key.signsInTo}. Your assistant cannot take it.`;
  }
  return [
    key.note,
    key.source === undefined ? "" : `Kept in ${key.source}`,
    (nowMs === undefined ? null : savedKeyExpiryLine(key, nowMs, locale)) ?? "",
    used,
  ]
    .filter((part) => part !== "")
    .join(" · ");
}
