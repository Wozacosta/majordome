import { describe, expect, it } from "vite-plus/test";
import { defaultTopicFolder } from "./topicFolder.ts";

describe("defaultTopicFolder", () => {
  it.each([
    ["projects", "Moving to Lisbon", "projects/moving-to-lisbon"],
    ["1. Projects/", "Café", "1. Projects/cafe"],
    ["projects", "", "projects"],
  ])("puts %s + %s at %s", (projectsFolder, title, folder) => {
    expect(defaultTopicFolder(projectsFolder, title)).toBe(folder);
  });
});
