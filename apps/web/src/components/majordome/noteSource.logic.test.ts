import { describe, expect, it } from "vite-plus/test";

import { nextListMarker, styleNoteLines } from "./noteSource.logic";

const style = (line: string) => styleNoteLines([line])[0]!;
/** Each span as `kind:text`, in order. */
const spans = (line: string) =>
  style(line).spans.map((span) => `${span.kind}:${line.slice(span.from, span.to)}`);

describe("styleNoteLines", () => {
  it("hides a heading's marker and sizes the line", () => {
    expect(style("## Top priorities").block).toBe("h2");
    expect(spans("## Top priorities")).toEqual(["syntax:## "]);
    expect(style("#hashtag").block).toBe("text");
  });

  it("styles inline marks and hides their delimiters", () => {
    expect(spans("a **b** and `c*d*` ~~e~~ _f_")).toEqual([
      "syntax:**",
      "bold:b",
      "syntax:**",
      "syntax:`",
      "code:c*d*",
      "syntax:`",
      "syntax:~~",
      "strike:e",
      "syntax:~~",
      "syntax:_",
      "italic:f",
      "syntax:_",
    ]);
    expect(spans("snake_case_name and 3 * 4 * 5")).toEqual([]);
  });

  it("keeps a link's label and hides its address", () => {
    const line = "→ [bill PDF](../projects/bill/108.pdf) and [[notes/Plan#Stay|the plan]]";
    expect(spans(line)).toEqual([
      "syntax:[",
      "link:bill PDF",
      "syntax:](../projects/bill/108.pdf)",
      "syntax:[[notes/Plan#Stay|",
      "wiki:the plan",
      "syntax:]]",
    ]);
    expect(style(line).spans.map((span) => span.target)).toEqual([
      undefined,
      "../projects/bill/108.pdf",
      undefined,
      undefined,
      "notes/Plan",
      undefined,
    ]);
  });

  it("reads list items and checkboxes", () => {
    expect(style("- milk")).toMatchObject({ block: "list", task: null });
    expect(spans("  - milk")).toEqual(["bullet:-"]);
    expect(style("- [ ] call")).toMatchObject({ block: "task", task: { at: 3, checked: false } });
    expect(spans("- [ ] call")).toEqual(["syntax:- [ ] "]);
    expect(style("1. [x] **PRC**")).toMatchObject({
      block: "task-done",
      task: { at: 4, checked: true },
    });
    expect(spans("1. [x] **PRC**").slice(0, 2)).toEqual(["syntax:[x] ", "syntax:**"]);
    expect(style("---").block).toBe("rule");
  });

  it("leaves code fences and frontmatter as written", () => {
    const blocks = styleNoteLines([
      "---",
      "tags: **a**",
      "---",
      "text",
      "```ts",
      "# not a heading",
      "```",
      "# heading",
    ]).map((line) => line.block);
    expect(blocks).toEqual(["meta", "meta", "meta", "text", "code", "code", "code", "h1"]);
    expect(styleNoteLines(["---", "# after a rule"]).map((line) => line.block)).toEqual([
      "rule",
      "h1",
    ]);
  });
});

describe("nextListMarker", () => {
  it("continues a list and ends it on an empty item", () => {
    expect(nextListMarker("- milk")).toEqual({ marker: "- " });
    expect(nextListMarker("  * [x] done")).toEqual({ marker: "  * [ ] " });
    expect(nextListMarker("9. nine")).toEqual({ marker: "10. " });
    expect(nextListMarker("- [ ] ")).toBe("clear");
    expect(nextListMarker("plain")).toBeNull();
  });
});
