import { describe, expect, it } from "vite-plus/test";

import {
  buildTopicFolderPrompt,
  resolveTopicFolderAnswer,
  type TopicFolderRequest,
} from "./topicFolderSuggestion.ts";

const request: TopicFolderRequest = {
  title: "Paying Electricity Bill Online",
  folders: ["personal", "personal/finances", "personal/Health", "research", "research/ai"],
  taken: new Set(["research/ai", "projects/taxes"]),
  projectsFolder: "projects",
  layout: { dailyFolder: "daily", inboxFolder: "inbox" },
};

describe("resolveTopicFolderAnswer", () => {
  it.each([
    ["personal/finances", { folder: "personal/finances", existing: true }],
    ["`Personal/health/`\n\nIt fits best.", { folder: "personal/Health", existing: true }],
    ["personal/finances/electricity", { folder: "personal/finances/electricity", existing: false }],
    ["personal/home/electricity", { folder: "personal/home/electricity", existing: false }],
    ['"projects/electricity-bill"', { folder: "projects/electricity-bill", existing: false }],
    ["PERSONAL/Health/gp-visits", { folder: "personal/Health/gp-visits", existing: false }],
  ])("accepts %s", (answer, expected) => {
    expect(resolveTopicFolderAnswer(answer, request)).toEqual(expected);
  });

  it.each([
    ["nothing", ""],
    ["an absolute path", "/Users/me/notes/personal/finances"],
    ["a path that climbs out", "personal/../../etc"],
    ["a hidden folder", "personal/.secrets"],
    ["more than three levels", "personal/finances/bills/electricity"],
    ["more than 80 characters", `personal/${"a".repeat(80)}`],
    ["a new name that is not lowercase words with hyphens", "personal/Electricity Bills"],
    ["a new folder outside every listed folder", "household/electricity"],
    ["a new top-level folder", "electricity"],
    ["a sentence", "I would put it in personal/finances."],
    ["another topic's folder", "research/ai"],
    ["another topic's folder that is not listed", "projects/taxes"],
    ["the projects folder itself", "projects"],
    ["the daily notes", "daily/electricity"],
    ["an attachments folder", "personal/attachments"],
  ])("refuses %s", (_what, answer) => {
    expect(resolveTopicFolderAnswer(answer, request)).toBeNull();
  });
});

describe("buildTopicFolderPrompt", () => {
  it("cuts a long first message short and leaves it out when there is none", () => {
    const long = buildTopicFolderPrompt({ ...request, firstMessage: `Bill\n${"x".repeat(900)}` });
    expect(long).toContain(`Bill ${"x".repeat(495)}\n</first_message>`);
    expect(buildTopicFolderPrompt(request)).not.toContain("first_message");
  });
});
