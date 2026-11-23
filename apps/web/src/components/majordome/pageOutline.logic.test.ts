import { describe, expect, it } from "vite-plus/test";

import { currentHeading, outlineGroups } from "./pageOutline.logic";

describe("outlineGroups", () => {
  it("lists nothing for a page with only a couple of sections", () => {
    expect(
      outlineGroups([
        { label: "One", kind: "section" },
        { label: "Two", kind: "section" },
      ]),
    ).toEqual([]);
  });

  it("puts each computer's sections on its own line", () => {
    const groups = outlineGroups([
      { label: "This Mac", kind: "title" },
      { label: "AI", kind: "nested" },
      { label: "Server", kind: "title" },
      { label: "AI", kind: "nested" },
      { label: "Restore", kind: "section" },
      { label: "From a folder", kind: "nested" },
    ]);
    expect(
      groups.map((group) => [group.title?.label ?? null, group.sections.map((s) => s.index)]),
    ).toEqual([
      ["This Mac", [1]],
      ["Server", [3]],
      [null, [4, 5]],
    ]);
  });
});

describe("currentHeading", () => {
  it("is the last heading above the line, and the last of all at the page's end", () => {
    expect(currentHeading([10, 200, 900], 250, false)).toBe(1);
    expect(currentHeading([300, 600], 250, false)).toBe(0);
    expect(currentHeading([10, 200, 900], 250, true)).toBe(2);
  });
});
