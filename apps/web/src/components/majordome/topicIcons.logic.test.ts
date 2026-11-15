import { describe, expect, it } from "vite-plus/test";

import { autoTopicIcon, topicIcon } from "./topicIcons.logic";

describe("autoTopicIcon", () => {
  it("picks an icon from the title's words, in English or French", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["Fitness log", "dumbbell"],
      ["Musculation", "dumbbell"],
      ["Marathon training", "footprints"],
      ["Course à pied", "footprints"],
      ["Accounting", "receipt"],
      ["Impôts 2026", "receipt"],
      ["Compta SASU", "receipt"],
      ["Finances perso", "wallet"],
      ["Crypto finance", "bitcoin"],
      ["Web3", "bitcoin"],
      ["Voyage au Japon", "plane"],
      ["Quitting nicotine", "heart-pulse"],
      ["Santé", "heart-pulse"],
      ["Chinese HSK 4", "languages"],
      ["Apprendre le portugais", "languages"],
      ["Online course", "book-open"],
      ["Job search", "briefcase"],
      ["CV", "briefcase"],
      ["Lisbon move", "home"],
      ["Déménagement", "home"],
      ["Recettes de cuisine", "utensils"],
      ["Guitar practice", "music"],
      ["Side project", "code"],
      ["Grocery list", "hash"],
    ];
    for (const [title, icon] of cases) {
      expect(autoTopicIcon(title, "notes/x"), title).toBe(icon);
    }
  });

  it("falls back on the folder, deepest name first, past the folders that only sort others", () => {
    expect(autoTopicIcon("Lisa", "areas/health/lisa")).toBe("heart-pulse");
    expect(autoTopicIcon("2026", "1. Projects/taxes/2026")).toBe("receipt");
    // `projects` sorts folders; it says nothing about the topic.
    expect(autoTopicIcon("Atlas", "projects/atlas")).toBe("hash");
  });

  it("keeps the icon the owner chose", () => {
    expect(topicIcon({ title: "Fitness", folder: "projects/fitness", icon: "music" })).toBe(
      "music",
    );
    expect(topicIcon({ title: "Fitness", folder: "projects/fitness" })).toBe("dumbbell");
  });
});
