import { describe, expect, it } from "vite-plus/test";

import { firstKeyFacts, keyFactGroups } from "./keyFacts.logic";

describe("keyFactGroups", () => {
  it("lists the facts by kind, newest first, and names a link by what it is", () => {
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
        { kind: "date", value: "2027-01-31" },
      ],
      { today: "2026-11-24", locale: "en-GB" },
    );
    expect(groups.map((group) => group.title)).toEqual(["Links", "Dates", "Names"]);
    // Soonest first, yesterday left out, a day that could not be worked out last.
    expect(groups[1]?.rows.map((row) => row.label)).toEqual([
      "Tue, 24 Nov 2026, 16:30",
      "Thu, 26 Nov 2026, 10:00",
      "Sun, 31 Jan 2027",
      "early spring",
    ]);
    const first = firstKeyFacts(groups);
    expect(first.groups.map((group) => group.rows.length)).toEqual([2, 2, 2]);
    expect(first.remaining).toBe(2);
    expect(groups[0]?.rows.map((row) => [row.label, row.detail, row.href])).toEqual([
      ["example.com/a/b", null, "https://example.com/a/b?x=1"],
      ["booking page", "doctolib.fr/arnaud", "https://www.doctolib.fr/arnaud/"],
    ]);
    expect(groups[2]?.rows.map((row) => [row.label, row.detail, row.href])).toEqual([
      ["Léa", null, null],
      ["Dr Arnaud", "dentist", null],
    ]);
  });
});
