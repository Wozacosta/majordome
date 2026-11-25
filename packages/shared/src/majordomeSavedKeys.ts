// @effect-diagnostics globalDate:off -- When a key was last used is said in the reader's own locale via Intl.
import type { MajordomeSavedKey } from "@t3tools/contracts";

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

/** The line under a key's name: what it is for, and when the assistant last took it. */
export function savedKeyLine(
  key: Pick<MajordomeSavedKey, "note" | "lastUsedAt">,
  locale?: string,
  timeZone?: string,
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
  return key.note === "" ? used : `${key.note} · ${used}`;
}
