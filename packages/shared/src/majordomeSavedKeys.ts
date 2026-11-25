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

/**
 * The line under a key's name: what it is for, the secret source it is kept in, and when the
 * assistant last took it. A key a source signs in with says so instead: it is never taken.
 */
export function savedKeyLine(
  key: Pick<MajordomeSavedKey, "note" | "lastUsedAt" | "source" | "signsInTo">,
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
  if (key.signsInTo !== undefined) {
    return `Signs Majordome in to ${key.signsInTo}. Your assistant cannot take it.`;
  }
  return [key.note, key.source === undefined ? "" : `Kept in ${key.source}`, used]
    .filter((part) => part !== "")
    .join(" · ");
}
