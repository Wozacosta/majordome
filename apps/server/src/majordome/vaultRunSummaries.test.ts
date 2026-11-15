import { describe, expect, it } from "vite-plus/test";

import {
  dailyNotePreview,
  noteHeading,
  replySummary,
  routineOf,
  runOrdinalOf,
  touchedDailyNote,
} from "./vaultRunSummaries.ts";

describe("replySummary", () => {
  it.each([
    [
      "Filed **two** notes into [Lisbon move](projects/lisbon.md).",
      "Filed two notes into Lisbon move.",
    ],
    [
      "# Morning brief\n\n## Today\n\nThree meetings, one *deadline*.\n\nMore later.",
      "Three meetings, one deadline.",
    ],
    [
      "```bash\nls\n```\n\n---\n\n| a | b |\n\nDone, see [[daily/2026-11-15|today]].",
      "Done, see today.",
    ],
    [
      "- Moved the receipt.\n- [x] Added `rent` to the budget;\n1. Tagged it",
      "Moved the receipt; Added rent to the budget; Tagged it",
    ],
    ["Line one\nline two", "Line one line two"],
    ["## Only a heading", null],
    ["", null],
  ])("%j", (text, summary) => {
    expect(replySummary(text)).toBe(summary);
  });

  it("cuts long replies at a word", () => {
    const summary = replySummary(`${"word ".repeat(80)}end`, 40);
    expect(summary).toBe("word word word word word word word word…");
  });
});

describe("notes", () => {
  it("reads a note's first top-level heading after its frontmatter", () => {
    expect(noteHeading("---\ntitle: x\n---\n## Not this\n# Lisbon **move**\n")).toBe("Lisbon move");
    expect(noteHeading("Just text\n## Sub\n")).toBeNull();
  });

  it("previews a daily note as a few plain lines", () => {
    expect(
      dailyNotePreview(
        "---\ntags: [daily]\n---\n# Sunday\n\n## Plan\n- [ ] Call the **notary**\n\nRain later.\n",
      ),
    ).toBe("Plan\n• Call the notary\nRain later.");
    expect(dailyNotePreview("# Empty day\n")).toBeNull();
  });

  it("finds the daily note a change touched", () => {
    expect(touchedDailyNote(["inbox/a.pdf", "Journal/2026-11-15.md"], "Journal/")).toBe(
      "Journal/2026-11-15.md",
    );
    expect(touchedDailyNote(["daily/notes.md", "memory.md"], "daily")).toBeNull();
  });
});

describe("runs", () => {
  it("reads the run number from a run commit's body", () => {
    expect(runOrdinalOf("Run 12 of this thread.")).toBe(12);
    expect(runOrdinalOf("Reverts abc1234.")).toBeNull();
  });

  it("knows the default routines by their task, or by their title", () => {
    expect(
      routineOf({ scheduledTaskId: "majordome:p-1:digest-my-inbox", subject: "majordome: x" }),
    ).toBe("digest-my-inbox");
    expect(routineOf({ scheduledTaskId: undefined, subject: "majordome: Start my day" })).toBe(
      "start-my-day",
    );
    expect(routineOf({ scheduledTaskId: "other", subject: "majordome: Lisbon" })).toBeNull();
  });
});
