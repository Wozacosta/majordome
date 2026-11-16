import {
  MAJORDOME_NOTES_SEARCH_QUERY_MAX,
  type MajordomeNotesSearchHit,
  type MajordomeNotesSearchResult,
} from "@t3tools/contracts";

import { type Brain, type BrainCopy, brainKey } from "./brains.logic";
import { isUnknownRequest } from "./connections.logic";

/** Long enough to skip a request per keystroke, short enough to feel like typing. */
export const NOTES_SEARCH_DEBOUNCE_MS = 150;
export const NOTES_SEARCH_LIMIT = 30;

/** What is sent for what was typed; empty when there is nothing to search for. */
export function notesSearchQuery(typed: string): string {
  // A pasted wall of text searches by its start instead of failing the request.
  return typed.trim().slice(0, MAJORDOME_NOTES_SEARCH_QUERY_MAX).trim();
}

/**
 * The copies of the shown brain a search may ask, in order: the one on screen, which is the
 * window's own server when the brain is there, then the brain's other machines.
 */
export function notesSearchCopies<C extends BrainCopy>(
  brains: ReadonlyArray<Brain<C>>,
  shown: C,
): ReadonlyArray<C> {
  const others = brains.find((brain) => brain.key === brainKey(shown))?.copies ?? [];
  return [
    shown,
    ...others.filter(
      (copy) => copy.environmentId !== shown.environmentId || copy.projectId !== shown.projectId,
    ),
  ];
}

/** One copy's answer, as its query atom gives it. */
export interface NotesSearchAnswer {
  readonly data: MajordomeNotesSearchResult | null;
  readonly waiting: boolean;
  /** The failure, squashed; null when the request did not fail. */
  readonly error: unknown;
}

/** True when this copy cannot answer and the next one should be asked. */
export function notesSearchShouldFallBack(answer: NotesSearchAnswer): boolean {
  return answer.data === null && answer.error !== null;
}

export type NotesSearchView =
  /** Nothing typed: the folders show. */
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | {
      readonly kind: "results";
      readonly results: ReadonlyArray<MajordomeNotesSearchHit>;
      /** A line above the results: the index is not complete, or is broken. */
      readonly notice: NotesSearchNotice | null;
      /** True while newer results for what is typed are on their way. */
      readonly stale: boolean;
    }
  | { readonly kind: "empty"; readonly notice: NotesSearchNotice | null }
  /** The server is from before notes search. */
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" };

export interface NotesSearchNotice {
  readonly tone: "neutral" | "warning";
  readonly text: string;
}

function notice(status: MajordomeNotesSearchResult["status"]): NotesSearchNotice | null {
  if (status === null) return null;
  if (status.state === "building") {
    return {
      tone: "neutral",
      text: "Still reading your notes. Some may be missing from these results for a moment.",
    };
  }
  if (status.state === "error") {
    return {
      tone: "warning",
      text: `${status.reason ?? "The notes search is not working."} Majordome will try again in a few minutes.`,
    };
  }
  return null;
}

/**
 * What the search shows. `settled` is the debounced query the answer is for; while it trails
 * what is typed, or its answer is on the way, the last results stay up instead of flashing away.
 */
export function notesSearchView(input: {
  readonly typed: string;
  readonly settled: string;
  readonly answer: NotesSearchAnswer;
  /** The last results shown for an earlier query. */
  readonly previous: MajordomeNotesSearchResult | null;
}): NotesSearchView {
  const query = notesSearchQuery(input.typed);
  if (query === "") return { kind: "idle" };
  const current = query === input.settled ? input.answer : null;
  if (current !== null && current.data === null && current.error !== null) {
    return isUnknownRequest(current.error) ? { kind: "unavailable" } : { kind: "failed" };
  }
  const fresh = current?.data ?? null;
  const shown = fresh ?? input.previous;
  if (shown === null) return { kind: "searching" };
  const stale = fresh === null || (current?.waiting ?? false);
  if (shown.results.length === 0) {
    // "No notes" is only said about what is typed now.
    return stale ? { kind: "searching" } : { kind: "empty", notice: notice(shown.status) };
  }
  return { kind: "results", results: shown.results, notice: notice(shown.status), stale };
}

export interface SnippetPart {
  readonly text: string;
  readonly match: boolean;
}

/** A snippet as runs of plain and matched text; ranges that are out of order or bounds are skipped. */
export function splitHighlights(
  snippet: string,
  highlights: ReadonlyArray<{ readonly start: number; readonly end: number }>,
): ReadonlyArray<SnippetPart> {
  const parts: Array<SnippetPart> = [];
  let cursor = 0;
  for (const { start, end } of highlights) {
    if (start < cursor || end <= start || end > snippet.length) continue;
    if (start > cursor) parts.push({ text: snippet.slice(cursor, start), match: false });
    parts.push({ text: snippet.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < snippet.length) parts.push({ text: snippet.slice(cursor), match: false });
  return parts;
}

/** Where a result is, as one line: its folder path, then the heading the match is under. */
export function notesSearchLocation(hit: MajordomeNotesSearchHit): string {
  const path = hit.path.split("/").join(" / ");
  return hit.heading === null || hit.heading === hit.title ? path : `${path} · ${hit.heading}`;
}
