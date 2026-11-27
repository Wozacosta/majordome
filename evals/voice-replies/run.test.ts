import { describe, expect, it } from "vite-plus/test";

import { grade } from "./grade.ts";

const spoken = { noTable: true, noList: true, noHeading: true, noCode: true, maxWords: 20 };

describe("voice-replies grader", () => {
  it("passes short plain sentences", () => {
    expect(grade("The small laptop is the one to take. It is the lightest.", spoken)).toEqual({
      pass: true,
      failures: [],
    });
  });

  it("names each kind of chat formatting", () => {
    const reply = "## Options\n\n| a | b |\n|---|---|\n\n- first\n1. second\n\nRun `git reset`.";
    expect(grade(reply, spoken).failures).toEqual([
      "has a table",
      "has a list",
      "has a heading",
      "has code",
    ]);
  });

  it("fails a reply that is too long to listen to", () => {
    expect(grade("word ".repeat(21), spoken).failures).toEqual(["21 words, over 20"]);
  });

  it("does not take a dash inside a sentence for a list", () => {
    expect(grade("It is light - about a kilo - and cheap.", spoken).pass).toBe(true);
  });

  it("checks what the reply must mention, whatever the case", () => {
    const checks = { mentions: [{ pattern: "screen", label: "says the detail is on screen" }] };
    expect(grade("The rest is on Screen.", checks).pass).toBe(true);
    expect(grade("That is all.", checks).failures).toEqual(["says the detail is on screen"]);
  });

  it("asks a control for its usual structure", () => {
    expect(grade("| a | b |\n|---|---|", { structured: true }).pass).toBe(true);
    expect(grade("Just prose.", { structured: true }).failures).toEqual([
      "neither a table nor a list",
    ]);
  });

  it("fails an empty reply", () => {
    expect(grade("  ", {}).failures).toEqual(["empty reply"]);
  });
});
