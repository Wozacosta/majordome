import type { MajordomeChatKnowledgeResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { chatKnowledgeView } from "./majordomeChatKnowledge.ts";

const NOTHING: MajordomeChatKnowledgeResult = {
  isVault: true,
  memory: null,
  dailyNotes: [],
  topic: null,
  otherTopics: [],
};

describe("chatKnowledgeView", () => {
  it("shows nothing for a chat outside a notes folder", () => {
    expect(chatKnowledgeView(null)).toBeNull();
    expect(chatKnowledgeView({ ...NOTHING, isVault: false })).toBeNull();
  });

  it("lists what the chat starts with, then the topics it only knows the standing of", () => {
    const view = chatKnowledgeView({
      isVault: true,
      memory: { path: "memory.md", cut: true },
      me: { path: "me.md" },
      dailyNotes: [{ day: "today", path: "daily/2026-11-25.md" }],
      topic: { id: "fitness", title: "Fitness", folder: "personal/fitness" },
      otherTopics: [
        { id: "tax", title: "Tax", folder: "personal/tax", standing: "Return due 15 December." },
        ...Array.from({ length: 9 }, (_, index) => ({
          id: `t${index}`,
          title: `Topic ${index}`,
          folder: `projects/t${index}`,
          standing: null,
        })),
      ],
    });
    expect(view?.starts.map((row) => [row.label, row.path])).toEqual([
      ["Notes of Fitness", null],
      ["Memory note", "memory.md"],
      ["About you", "me.md"],
      ["Today's note", "daily/2026-11-25.md"],
    ]);
    expect(view?.starts[1]?.detail).toContain("its end is left out");
    expect(view?.others).toHaveLength(8);
    expect(view?.others[0]).toMatchObject({
      label: "Tax",
      detail: "Return due 15 December.",
      path: "personal/tax/log.md",
    });
    expect(view?.others[1]?.path).toBeNull();
    expect(view?.rest.map((row) => row.label)).toEqual(["Topic 7", "Topic 8"]);
  });

  it("offers to start the note about the owner when the notes have none", () => {
    const view = chatKnowledgeView({ ...NOTHING, me: null });
    expect(view?.starts[1]).toEqual({
      key: "me",
      kind: "me",
      label: "About you",
      detail: "Nothing yet",
      path: null,
      canStart: true,
    });
  });

  it("says the memory note is empty rather than leaving it out", () => {
    const view = chatKnowledgeView(NOTHING);
    expect(view?.starts).toHaveLength(1);
    expect(view?.starts[0]).toMatchObject({ kind: "memory", path: null });
    expect(view?.starts[0]?.detail).toContain("Empty so far");
  });
});
