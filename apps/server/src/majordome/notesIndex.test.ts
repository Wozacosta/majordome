import { expect, it } from "vite-plus/test";

import {
  headingAt,
  isNoteFile,
  isSkippedEntry,
  MATCH_END,
  MATCH_START,
  normalizeFolder,
  notesMatchQuery,
  readNote,
  shapeSnippet,
  SNIPPET_LENGTH,
} from "./notesIndex.ts";

it("indexes text notes and leaves plumbing, data and binary files out", () => {
  expect(["a.md", "A.MARKDOWN", "b.mdx", "c.txt", "d.org"].every(isNoteFile)).toBe(true);
  expect(
    ["photo.png", "scan.pdf", "board.canvas", "data.csv", "README", ".md"].some(isNoteFile),
  ).toBe(false);
  expect([".git", ".majordome", ".obsidian", ".trash", "node_modules"].every(isSkippedEntry)).toBe(
    true,
  );
  expect(isSkippedEntry("projects")).toBe(false);
  expect(readNote("scan.md", "PK\u0000\u0003binary")).toBeNull();
});

it("reads a note's title and headings, counting offsets the way SQLite counts characters", () => {
  const note = readNote(
    "trips/lisbon.md",
    "\uFEFFIntro 😀\n# Lisbon ##\n```\n# not a heading\n```\n## Hôtel\ntext",
  );
  expect(note?.title).toBe("Lisbon");
  // The emoji is two UTF-16 units and one character.
  expect(note?.headings).toEqual([
    { offset: 8, text: "Lisbon" },
    { offset: 44, text: "Hôtel" },
  ]);
  expect(headingAt(note?.headings ?? [], 7)).toBeNull();
  expect(headingAt(note?.headings ?? [], 20)).toBe("Lisbon");
  expect(headingAt(note?.headings ?? [], 50)).toBe("Hôtel");
  expect(readNote("inbox/Call the bank.txt", "# not markdown")?.title).toBe("Call the bank");
});

it("turns what is typed into quoted FTS5 terms, the last word a prefix", () => {
  const cases: ReadonlyArray<readonly [string, string | null]> = [
    ["impots", '"impots"*'],
    ["  tax  return ", '"tax" "return"*'],
    ['"tax return" 2026', '"tax return" "2026"*'],
    ['2026 "tax return"', '"2026" "tax return"'],
    ['"unfinished phrase', '"unfinished phrase"'],
    ['say"hi', '"say""hi"*'],
    ["l'été", '"l\'été"*'],
    // FTS5 operators and punctuation are words or nothing, never syntax.
    [
      "tax AND NOT (return OR NEAR) col:x ^y z*",
      '"tax" "AND" "NOT" "(return" "OR" "NEAR)" "col:x" "^y" "z*"*',
    ],
    ['- * ( ) "" " " ^ :', null],
    ["", null],
  ];
  for (const [typed, match] of cases) expect(notesMatchQuery(typed), typed).toBe(match);
});

it("keeps a folder filter inside the vault's own path form", () => {
  expect(normalizeFolder(undefined)).toBeNull();
  expect(normalizeFolder(" ./ ")).toBeNull();
  expect(normalizeFolder("/projects\\house/")).toBe("projects/house");
});

it("cuts a readable one-line snippet and says where the matches are in it", () => {
  const marked = (text: string) => text.replaceAll("[", MATCH_START).replaceAll("]", MATCH_END);
  const whole = shapeSnippet(marked("# Trip\n\nBook the **[hôtel]**   in `Lisbon`\n"), {
    before: false,
    after: false,
  });
  expect(whole.snippet).toBe("Trip Book the hôtel in Lisbon");
  expect(whole.highlights.map(({ start, end }) => whole.snippet.slice(start, end))).toEqual([
    "hôtel",
  ]);

  const cut = shapeSnippet(marked(`rtial word then the [match] and ${"more ".repeat(80)}`), {
    before: true,
    after: true,
  });
  expect(cut.snippet.startsWith("…word then the match and more")).toBe(true);
  expect(cut.snippet.endsWith("…")).toBe(true);
  expect(cut.snippet.length).toBeLessThanOrEqual(SNIPPET_LENGTH + 2);
  expect(cut.highlights.map(({ start, end }) => cut.snippet.slice(start, end))).toEqual(["match"]);

  // A match the length limit cuts through is still marked up to the cut.
  const long = shapeSnippet(marked(`${"x".repeat(SNIPPET_LENGTH - 2)} [match]`), {
    before: false,
    after: false,
  });
  expect(long.highlights.map(({ start, end }) => long.snippet.slice(start, end))).toEqual(["m"]);
});
