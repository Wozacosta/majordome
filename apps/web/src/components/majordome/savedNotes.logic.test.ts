import { expect, it } from "vite-plus/test";

import { savedNotes } from "./savedNotes.logic";

it("names changed notes in plain words and leaves out Majordome's own files", () => {
  const result = savedNotes(
    [
      "personal/fitness/training-log.md",
      ".majordome/state.json",
      ".agents/proposed-skills/file-receipts/SKILL.md",
      ".agents/proposed-skills/file-receipts/example.md",
      "photo.png",
      "a.md",
      "b.md",
    ],
    Date.UTC(2026, 10, 17),
    3,
  );
  expect(result.shown).toEqual([
    {
      path: "personal/fitness/training-log.md",
      title: "training log",
      folder: "Personal / Fitness",
      openable: true,
    },
    { path: "photo.png", title: "photo", folder: null, openable: false },
    { path: "a.md", title: "a", folder: null, openable: true },
  ]);
  expect(result.more).toBe(1);
  expect(result.skills).toEqual(["file-receipts"]);
});
