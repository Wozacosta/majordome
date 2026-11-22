import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  buildKeyFactsPrompt,
  keyFactsTranscript,
  mergeKeyFacts,
  parseDiagram,
  parseInShort,
  parseKeyFacts,
} from "./keyFacts.ts";

const transcript = keyFactsTranscript([
  {
    author: "owner",
    text: "Dentist is Dr Arnaud, 12 rue de Rivoli, next Tuesday at 9. https://doctolib.fr/arnaud",
  },
  { author: "assistant", text: "  " },
  { author: "assistant", text: "Noted for Tuesday." },
]);

describe("key facts", () => {
  it("labels each message and leaves out the empty ones", () => {
    expect(transcript.split("\n\n")).toEqual([
      "owner: Dentist is Dr Arnaud, 12 rue de Rivoli, next Tuesday at 9. https://doctolib.fr/arnaud",
      "assistant: Noted for Tuesday.",
    ]);
  });

  it("keeps the latest messages when a conversation is too long for one pass", () => {
    const long = keyFactsTranscript([
      { author: "owner", text: "first" },
      ...Array.from({ length: 7 }, () => ({
        author: "assistant" as const,
        text: "x".repeat(4_000),
      })),
      { author: "owner", text: "last" },
    ]);
    expect(long.startsWith("assistant: x")).toBe(true);
    expect(long.endsWith("owner: last")).toBe(true);
  });

  it("tells the model what is already listed", () => {
    const prompt = buildKeyFactsPrompt({
      today: DateTime.makeUnsafe("2026-11-22T12:00:00Z"),
      known: [{ kind: "person", value: "Dr Arnaud", note: "dentist" }],
      summary: [],
      transcript,
    });
    expect(prompt).toContain("Today is Sunday 2026-11-22.");
    expect(prompt).toContain("<already_listed>\nperson | Dr Arnaud | dentist\n</already_listed>");
  });

  it("keeps well-formed facts and drops links the conversation does not hold", () => {
    const answer = [
      "person | Dr Arnaud | dentist",
      "- place | 12 rue de Rivoli",
      "date | 2026-11-24 09:00 | dentist appointment",
      "link | https://doctolib.fr/arnaud | booking page",
      "link | https://made-up.example/page | invented",
      "link | doctolib.fr/arnaud",
      "idea | buy floss",
      "Here are the facts:",
    ].join("\n");
    expect(parseKeyFacts(answer, transcript)).toEqual([
      { kind: "person", value: "Dr Arnaud", note: "dentist" },
      { kind: "place", value: "12 rue de Rivoli" },
      { kind: "date", value: "2026-11-24 09:00", note: "dentist appointment" },
      { kind: "link", value: "https://doctolib.fr/arnaud", note: "booking page" },
    ]);
    expect(parseKeyFacts("none", transcript)).toEqual([]);
  });

  it("reads the short version from the same answer, and nothing else as one", () => {
    const answer = [
      "person | Dr Arnaud | dentist",
      "short | Booking the dentist | for next Tuesday.",
      "- Short | Still to do: confirm the time.",
      `short | ${"x".repeat(201)}`,
      "short |",
    ].join("\n");
    expect(parseInShort(answer)).toEqual([
      "Booking the dentist | for next Tuesday.",
      "Still to do: confirm the time.",
    ]);
    expect(parseKeyFacts(answer, transcript)).toHaveLength(1);
  });

  it("builds the drawing itself from the boxes and arrows it is given", () => {
    const answer = [
      "box | A | Lease ends in March",
      'box | B | Renew ["two" years]',
      "box | C | Move out",
      "box | A | said twice",
      "arrow | A | B | if rent stays",
      "arrow | A | C",
      "arrow | A | C",
      "arrow | A | Z | to nowhere",
      "arrow | B | B | to itself",
    ].join("\n");
    expect(parseDiagram(answer)).toBe(
      [
        "flowchart TD",
        '  n0["Lease ends in March"]',
        '  n1["Renew two years"]',
        '  n2["Move out"]',
        '  n0 -->|"if rent stays"| n1',
        "  n0 --> n2",
      ].join("\n"),
    );
    expect(parseDiagram("box | A | alone")).toBeNull();
    expect(parseDiagram("flowchart TD\n A --> B")).toBeNull();
  });

  it("adds new facts after the known ones, once each", () => {
    expect(
      mergeKeyFacts(
        [{ kind: "person", value: "Dr Arnaud" }],
        [
          { kind: "person", value: "dr arnaud", note: "dentist" },
          { kind: "place", value: "Rivoli" },
        ],
      ),
    ).toEqual([
      { kind: "person", value: "Dr Arnaud", note: "dentist" },
      { kind: "place", value: "Rivoli" },
    ]);
    const full = Array.from({ length: 40 }, (_, index) => ({
      kind: "place" as const,
      value: `place ${index}`,
    }));
    const merged = mergeKeyFacts(full, [{ kind: "place", value: "newest" }]);
    expect(merged).toHaveLength(40);
    expect(merged[0]?.value).toBe("place 1");
    expect(merged.at(-1)?.value).toBe("newest");
  });
});
