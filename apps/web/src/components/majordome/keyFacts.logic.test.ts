import { describe, expect, it } from "vite-plus/test";

import { firstKeyFacts, keyFactGroups, searchKeyFacts } from "./keyFacts.logic";

describe("keyFactGroups", () => {
  const groups = keyFactGroups(
    [
      { kind: "person", value: "Dr Arnaud", note: "dentist" },
      { kind: "link", value: "https://www.doctolib.fr/arnaud/", note: "booking page" },
      { kind: "link", value: "https://example.com/a/b?x=1" },
      { kind: "person", value: "Léa" },
      { kind: "date", value: "2026-11-26 10:00", note: "meeting" },
      { kind: "date", value: "early spring" },
      { kind: "date", value: "2026-11-24 16:30", note: "call, earlier today" },
      { kind: "date", value: "2026-11-23", note: "form sent" },
      { kind: "date", value: "2026-04-30", note: "overdue since" },
      { kind: "date", value: "2027-01-31" },
    ],
    { today: "2026-11-24", locale: "en-GB" },
  );

  it("lists what is coming first, then the rest by kind, and the days that are over last", () => {
    expect(groups.map((group) => group.title)).toEqual(["Dates", "Links", "Names", "Earlier"]);
    // Soonest first, a day that could not be worked out last.
    expect(groups[0]?.rows.map((row) => row.label)).toEqual([
      "Tue, 24 Nov 2026, 16:30",
      "Thu, 26 Nov 2026, 10:00",
      "Sun, 31 Jan 2027",
      "early spring",
    ]);
    expect(groups[1]?.rows.map((row) => [row.label, row.detail, row.href])).toEqual([
      ["example.com/a/b", null, "https://example.com/a/b?x=1"],
      ["booking page", "doctolib.fr/arnaud", "https://www.doctolib.fr/arnaud/"],
    ]);
    expect(groups[2]?.rows.map((row) => [row.label, row.detail, row.href])).toEqual([
      ["Léa", null, null],
      ["Dr Arnaud", "dentist", null],
    ]);
    expect(groups[3]?.rows.map((row) => row.detail)).toEqual(["form sent", "overdue since"]);
  });

  it("shows the chat's panel a few rows, never a day that is over", () => {
    const first = firstKeyFacts(groups);
    expect(first.rows.map((row) => row.label)).toEqual([
      "Tue, 24 Nov 2026, 16:30",
      "Thu, 26 Nov 2026, 10:00",
      "Sun, 31 Jan 2027",
    ]);
    expect(first.remaining).toBe(7);
    expect(firstKeyFacts(groups.slice(3))).toEqual({ rows: [], remaining: 2 });
  });

  it("finds rows by any of their words", () => {
    expect(
      searchKeyFacts(groups, "ARNAUD").map((group) => [
        group.title,
        group.rows.map((row) => row.label),
      ]),
    ).toEqual([
      ["Links", ["booking page"]],
      ["Names", ["Dr Arnaud"]],
    ]);
    expect(searchKeyFacts(groups, "  ")).toBe(groups);
  });
});
