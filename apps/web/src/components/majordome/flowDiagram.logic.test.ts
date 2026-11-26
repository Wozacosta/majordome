import { describe, expect, it } from "vite-plus/test";

import { flowLayout } from "./flowDiagram.logic";

describe("flowLayout", () => {
  it("centres the shorter columns on the longest one", () => {
    const layout = flowLayout([1, 3, 2]);
    expect(layout.height).toBe(192);
    expect(layout.middleOf(1, 0)).toBe(28);
    expect(layout.middleOf(0, 0)).toBe(96);
    expect(layout.middleOf(2, 1)).toBe(130);
  });

  it("has no height with nothing to draw", () => {
    expect(flowLayout([]).height).toBe(0);
  });
});
