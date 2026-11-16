import {
  EnvironmentId,
  type MajordomeNotesSearchHit,
  type MajordomeNotesSearchResult,
  ProjectId,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { groupBrains } from "./brains.logic";
import {
  type NotesSearchAnswer,
  notesSearchCopies,
  notesSearchLocation,
  notesSearchQuery,
  notesSearchShouldFallBack,
  notesSearchView,
  splitHighlights,
} from "./notesSearch.logic";

const hit = (
  path: string,
  fields: Partial<MajordomeNotesSearchHit> = {},
): MajordomeNotesSearchHit => ({
  path,
  title: "Roof",
  heading: null,
  snippet: "Quote for the roof",
  highlights: [{ start: 14, end: 18 }],
  modifiedAt: "2026-11-15T08:00:00.000Z",
  ...fields,
});
const ready = { state: "ready", noteCount: 3, lastIndexedAt: "2026-11-16T09:00:00.000Z" } as const;
const found: MajordomeNotesSearchResult = { results: [hit("projects/house.md")], status: ready };
const nothing: MajordomeNotesSearchResult = { results: [], status: ready };
const answered = (data: MajordomeNotesSearchResult | null, waiting = false): NotesSearchAnswer => ({
  data,
  waiting,
  error: null,
});
const failed = (error: unknown): NotesSearchAnswer => ({ data: null, waiting: false, error });

it("sends what was typed, trimmed and cut to the server's limit", () => {
  expect(notesSearchQuery("   ")).toBe("");
  expect(notesSearchQuery("  roof quote ")).toBe("roof quote");
  expect(notesSearchQuery(`${"a".repeat(199)} bcd`)).toBe("a".repeat(199));
});

it("asks the shown copy first, then the brain's other machines, and never another brain", () => {
  const mac = EnvironmentId.make("mac");
  const server = EnvironmentId.make("server");
  const copy = (environmentId: EnvironmentId, project: string, brainId: string | null) => ({
    environmentId,
    projectId: ProjectId.make(project),
    brainId,
  });
  const mine = copy(mac, "notes", "brain-1");
  const mineOnServer = copy(server, "notes-clone", "brain-1");
  const other = copy(server, "work", "brain-2");
  const brains = groupBrains([mineOnServer, other, mine], mac);
  expect(notesSearchCopies(brains, mine)).toEqual([mine, mineOnServer]);
  expect(notesSearchCopies(brains, mineOnServer)).toEqual([mineOnServer, mine]);
  expect(notesSearchCopies(brains, other)).toEqual([other]);
});

it("falls back to another copy only when this one cannot answer", () => {
  expect(notesSearchShouldFallBack(failed("Unknown request tag: majordome.searchNotes"))).toBe(
    true,
  );
  expect(notesSearchShouldFallBack(failed(new Error("offline")))).toBe(true);
  expect(notesSearchShouldFallBack(answered(null, true))).toBe(false);
  expect(notesSearchShouldFallBack(answered(nothing))).toBe(false);
});

it("shows nothing for an empty box, then keeps the last results up until the next ones arrive", () => {
  const view = (
    typed: string,
    settled: string,
    answer: NotesSearchAnswer,
    previous: MajordomeNotesSearchResult | null = null,
  ) => notesSearchView({ typed, settled, answer, previous });

  expect(view("  ", "roof", answered(found), found)).toEqual({ kind: "idle" });
  // The first letters are typed and no request has answered yet.
  expect(view("ro", "", answered(null))).toEqual({ kind: "searching" });
  expect(view("ro", "ro", answered(null, true))).toEqual({ kind: "searching" });
  expect(view("roof", "roof", answered(found))).toEqual({
    kind: "results",
    results: found.results,
    notice: null,
    stale: false,
  });
  // Typing on: the debounce has not caught up, so the answer in hand is for older words.
  expect(view("roof q", "roof", answered(found), found)).toMatchObject({
    kind: "results",
    stale: true,
  });
  expect(view("roof q", "roof q", answered(null, true), found)).toMatchObject({
    kind: "results",
    stale: true,
  });
  expect(view("roof q", "roof q", answered(nothing), found)).toEqual({
    kind: "empty",
    notice: null,
  });
  // "No note" is never said about words the answer was not for.
  expect(view("zebra", "zeb", answered(nothing), nothing)).toEqual({ kind: "searching" });
});

it("says when the index is still being built or is broken, and when the server is too old", () => {
  const building: MajordomeNotesSearchResult = {
    results: found.results,
    status: { state: "building", noteCount: 0, lastIndexedAt: null },
  };
  const view = (answer: NotesSearchAnswer) =>
    notesSearchView({ typed: "roof", settled: "roof", answer, previous: null });
  expect(view(answered(building))).toMatchObject({
    kind: "results",
    notice: { tone: "neutral", text: expect.stringContaining("Still reading your notes") },
  });
  expect(
    view(
      answered({
        results: [],
        status: { ...ready, state: "error", reason: "The notes folder could not be read." },
      }),
    ),
  ).toEqual({
    kind: "empty",
    notice: {
      tone: "warning",
      text: "The notes folder could not be read. Majordome will try again in a few minutes.",
    },
  });
  expect(view(failed("Unknown request tag: majordome.searchNotes"))).toEqual({
    kind: "unavailable",
  });
  expect(view(failed(new Error("The environment request failed.")))).toEqual({ kind: "failed" });
});

it("splits a snippet into plain and matched runs, ignoring ranges that do not fit", () => {
  expect(splitHighlights("Quote for the roof", [{ start: 14, end: 18 }])).toEqual([
    { text: "Quote for the ", match: false },
    { text: "roof", match: true },
  ]);
  expect(
    splitHighlights("roof and roof", [
      { start: 0, end: 4 },
      { start: 2, end: 6 },
      { start: 9, end: 13 },
      { start: 12, end: 40 },
    ]),
  ).toEqual([
    { text: "roof", match: true },
    { text: " and ", match: false },
    { text: "roof", match: true },
  ]);
  expect(splitHighlights("plain", [])).toEqual([{ text: "plain", match: false }]);
  expect(splitHighlights("", [])).toEqual([]);
});

it("names where a result is: its folders, and the heading when it adds something", () => {
  expect(notesSearchLocation(hit("projects/house/roof.md", { heading: "Quotes" }))).toBe(
    "projects / house / roof.md · Quotes",
  );
  expect(notesSearchLocation(hit("roof.md", { heading: "Roof" }))).toBe("roof.md");
  expect(notesSearchLocation(hit("roof.md"))).toBe("roof.md");
});
