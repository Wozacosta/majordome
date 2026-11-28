import { expect, it, vi } from "vite-plus/test";

import { topicLinkCustomization } from "./topicLinks";

vi.mock("../lib/contextChipIcons.generated", () => ({
  TOPIC_CHIP_ICON_SOURCES: { hash: "hash.png", dumbbell: "dumbbell.png" },
}));

const topics = [
  {
    id: "fitness",
    title: "Fitness",
    threadId: null,
    preview: null,
    icon: "dumbbell",
    tone: "orange",
  },
  // A list an older build stored has no icon or colour.
  { id: "garden", title: "Garden", threadId: null, preview: null },
] as const;

it("draws a named topic as a chip in its colour with its icon", () => {
  expect(topicLinkCustomization("app://topic/fitness", topics)).toEqual({
    icon: "dumbbell.png",
    chip: { accent: "#f97316", tintsIcon: true, background: "#f9731626" },
  });
  expect(topicLinkCustomization("app://topic/garden", topics)).toEqual({
    icon: "hash.png",
    chip: { accent: "#f59e0b", tintsIcon: true, background: "#f59e0b26" },
  });
});

it("leaves a topic this phone does not list, and any other link, as they are", () => {
  expect(topicLinkCustomization("app://topic/gone", topics)).toBeUndefined();
  expect(topicLinkCustomization("app://settings/phone", topics)).toBeUndefined();
});
