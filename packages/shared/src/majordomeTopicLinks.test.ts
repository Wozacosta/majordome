import { describe, expect, it } from "vite-plus/test";

import { formatTopicLink, parseTopicHref, topicHref } from "./majordomeTopicLinks.ts";

describe("topic links", () => {
  it.each([
    ["app://topic/fitness", "fitness"],
    ["app://topic/quitting-nicotine-2/", "quitting-nicotine-2"],
    ["app://topic", null],
    ["app://topic/a/b", null],
    ["app://settings/phone", null],
    ["personal/fitness/log.md", null],
  ])("reads %s as %s", (href, expected) => {
    expect(parseTopicHref(href)).toBe(expected);
  });

  it("reads back the link it writes", () => {
    expect(formatTopicLink("Fitness", "fitness")).toBe("[Fitness](app://topic/fitness)");
    expect(parseTopicHref(topicHref("fitness") ?? "")).toBe("fitness");
  });

  it("writes the bare title for an id a link cannot carry", () => {
    expect(topicHref("Mes Impôts")).toBeNull();
    expect(formatTopicLink("Mes impôts", "Mes Impôts")).toBe("Mes impôts");
  });
});
