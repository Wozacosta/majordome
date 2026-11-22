import { assert, describe, it } from "@effect/vitest";

import { firstMeaningfulLine, pickTopicPreview, topicStanding } from "./topicPreview.ts";

describe("topic previews", () => {
  it("reads the first line that says something, without its markdown", () => {
    const cases: ReadonlyArray<readonly [string, string | null]> = [
      ["## Weekly plan\n\nRun 5k", "Weekly plan"],
      ["\n\n---\n> **Done**: logged *three* runs", "Done: logged three runs"],
      ["```ts\nconst x = 1;\n```\n- [x] Paid the `URSSAF` bill", "Paid the URSSAF bill"],
      ["See [the note](notes/a.md) and [[Lisbon move|the move]]", "See the note and the move"],
      ["| Day | Km |\n|---|---|\n| Mon | 5 |", "Day · Km"],
      ["1. Impôts : déclarer avant le 20", "Impôts : déclarer avant le 20"],
      ["snake_case_name stays", "snake_case_name stays"],
      ["```\nonly code\n```", null],
      ["   \n***\n", null],
    ];
    for (const [markdown, expected] of cases) {
      assert.equal(firstMeaningfulLine(markdown), expected, markdown);
    }
    const long = firstMeaningfulLine("word ".repeat(60))!;
    assert.isAtMost(long.length, 120);
    assert.isTrue(long.endsWith("…"));
  });

  it("shows the latest message with words in it, and whose it is", () => {
    assert.deepEqual(
      pickTopicPreview([
        { author: "agent", text: "Logged it." },
        { author: "you", text: "Add Thursday's run" },
      ]),
      { author: "you", text: "Add Thursday's run" },
    );
    assert.deepEqual(
      pickTopicPreview([
        { author: "you", text: "Add Thursday's run" },
        { author: "agent", text: "**Added** Thursday." },
        { author: "agent", text: "```\n{}\n```" },
      ]),
      { author: "agent", text: "Added Thursday." },
    );
    assert.isNull(pickTopicPreview([]));
  });

  it("reads where things stand from the top of a log", () => {
    const cases: ReadonlyArray<readonly [string, string | null]> = [
      [
        "## Where things stand\n- Visa file sent on 12 Nov.\n- Next: **flat viewing**, 28 Nov.\n\n## Log\n- 2026-11-12: sent the file",
        "Visa file sent on 12 Nov.\nNext: flat viewing, 28 Nov.",
      ],
      [
        "# Log\n\n### where things STAND:\n\nWaiting on the bank.\n# 2026-11-01",
        "Waiting on the bank.",
      ],
      ["## Where things stand\n\n## Log\n- 2026-11-12: sent the file", null],
      ["## Where things stand\n---\n\n", null],
      ["- 2026-11-12: sent the file\nWhere things stand: fine", null],
      ["## Where things stand now\nNot this heading", null],
      ["", null],
      ["## Where things stand\n1\n2\n3\n4\n5", "1\n2\n3\n4"],
    ];
    for (const [log, expected] of cases) {
      assert.equal(topicStanding(log), expected, log);
    }
    const long = topicStanding(`## Where things stand\n${"word ".repeat(200)}`)!;
    assert.isAtMost(long.length, 400);
    assert.isTrue(long.endsWith("…"));
  });
});
