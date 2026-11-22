import { describe, expect, it } from "vite-plus/test";

import {
  standingCollapsed,
  standingFirstLine,
  topicChipsState,
  topicComposerPlaceholder,
  topicWelcomeStarters,
} from "./TopicStarters.logic";

describe("a topic's message box", () => {
  it("names the topic in its placeholder", () => {
    expect(topicComposerPlaceholder("Taxes 2026")).toBe(
      "Message about Taxes 2026, or tell me what to remember",
    );
  });

  it("starts a first message with the topic's name, ready to be finished", () => {
    expect(topicWelcomeStarters("Taxes").map((starter) => starter.text)).toEqual([
      "Here's where things stand with Taxes: ",
      "I'm adding a document about Taxes: ",
      "Every week, check in with me about Taxes and ",
    ]);
  });

  const underWay = {
    isTopicChat: true,
    hasMessages: true,
    boxEmpty: true,
    working: false,
    boxTaken: false,
  };
  it.each([
    ["an empty box in a topic chat under way", underWay, "shown"],
    ["any other chat", { ...underWay, isTopicChat: false }, "none"],
    ["a topic chat nothing was said in", { ...underWay, hasMessages: false }, "none"],
    ["words already typed", { ...underWay, boxEmpty: false }, "reserved"],
    ["the assistant working", { ...underWay, working: true }, "reserved"],
    ["a question waiting for its answer", { ...underWay, boxTaken: true }, "reserved"],
  ] as const)("chips for %s", (_case, input, expected) => {
    expect(topicChipsState(input)).toBe(expected);
  });
});

describe("where things stand", () => {
  it("folds to its first written line", () => {
    expect(standingFirstLine("\n  Waiting on the notary.\nNext: sign on Friday.")).toBe(
      "Waiting on the notary.",
    );
  });

  it("starts folded only in a narrow window, until the owner chooses", () => {
    expect(standingCollapsed({}, "taxes", false)).toBe(false);
    expect(standingCollapsed({}, "taxes", true)).toBe(true);
    expect(standingCollapsed({ taxes: false }, "taxes", true)).toBe(false);
    expect(standingCollapsed({ taxes: true }, "other", false)).toBe(false);
  });
});
