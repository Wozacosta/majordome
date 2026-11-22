import { describe, expect, it } from "vite-plus/test";

import { keyFactGroups } from "./keyFacts.logic";

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
      ],
      "en-GB",
    );
    expect(groups.map((group) => group.title)).toEqual(["Links", "Dates", "Names"]);
    expect(groups[1]?.rows.map((row) => row.label)).toEqual([
      "early spring",
      "Thu, 26 Nov 2026, 10:00",
    ]);
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
