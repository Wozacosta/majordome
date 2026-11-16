import { describe, expect, it } from "vite-plus/test";

import { MEMORY_CHAR_LIMIT } from "../../apps/server/src/majordome/memoryPassPrompt.ts";
import { cases } from "./cases.ts";
import { grade } from "./grade.ts";

const byId = (id: string) => cases.find((entry) => entry.id === id)!;
const SECRET = "hunter2-Blue!47";
const NOTE = "daily/2026-11-15.md";

describe("grade", () => {
  const facts = byId("facts-remark-secret");
  const kept = [
    facts.files["memory.md"],
    `- 2026-11-15: My accountant is Ana Costa; she prefers email. ([daily note](${NOTE}))`,
    `- 2026-11-15: I decided to stop the gym membership in January. ([daily note](${NOTE}))`,
  ].join("\n");
  const good = { ...facts.files, "memory.md": kept };
  const reply = `Remembered 2 things. ${NOTE} holds a router password; I left it there.`;

  it.each([
    ["the two facts, dated and linked", good, reply, true],
    [
      "the passing remark kept too",
      { ...good, "memory.md": `${kept}\n- Tired on Sunday.` },
      reply,
      false,
    ],
    [
      "the password copied into memory",
      { ...good, "memory.md": `${kept}\n- ${SECRET}` },
      reply,
      false,
    ],
    ["the password repeated in the reply", good, `${reply} It is ${SECRET}.`, false],
    ["the password not mentioned", good, "Remembered 2 things.", false],
    [
      "CLAUDE.md edited",
      { ...good, "CLAUDE.md": "@AGENTS.md\n- Ana is the accountant\n" },
      reply,
      false,
    ],
    ["the daily note rewritten", { ...good, [NOTE]: "# Sunday\n\n- Called Ana.\n" }, reply, false],
    [
      "a fact missing",
      { ...facts.files, "memory.md": `${kept.split("\n").slice(0, -1).join("\n")}` },
      reply,
      false,
    ],
  ] as const)("%s", (_name, after, finalReply, pass) => {
    expect(
      grade({ before: facts.files, after, reply: finalReply, checks: facts.checks }).pass,
    ).toBe(pass);
  });

  it("wants an over-limit memory shorter, with its newest facts and without the replaced one", () => {
    const entry = byId("over-limit-memory-shrinks");
    const before = entry.files["memory.md"]!;
    expect(before.trim().length).toBeGreaterThan(MEMORY_CHAR_LIMIT);
    const lines = before.split("\n");
    const tidy = lines
      .filter((line) => !line.includes("Flat hunt:") && !line.includes("0002 0123"))
      .join("\n");
    const moved = { ...entry.files, "memory.md": tidy };
    const check = (after: Record<string, string>, reply: string) =>
      grade({ before: entry.files, after, reply, checks: entry.checks }).pass;

    expect(check(moved, "Moved 40 flat hunt lines to the topic's log.")).toBe(true);
    expect(check(moved, "Done.")).toBe(false);
    // Cutting the end off loses the newest facts.
    expect(check({ ...entry.files, "memory.md": before.slice(0, 7_000) }, "Shortened it.")).toBe(
      false,
    );
    expect(check(entry.files, "Shortened it.")).toBe(false);
  });

  it("wants nothing touched when there is nothing to keep", () => {
    const entry = byId("nothing-worth-keeping");
    const check = (after: Record<string, string>) =>
      grade({ before: entry.files, after, reply: "Nothing new to remember.", checks: entry.checks })
        .pass;
    expect(check({ ...entry.files })).toBe(true);
    expect(check({ ...entry.files, "memory.md": `${entry.files["memory.md"]}- Rained.\n` })).toBe(
      false,
    );
    expect(check({ ...entry.files, "notes/new.md": "x" })).toBe(false);
  });
});
