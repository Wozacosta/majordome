import { describe, expect, it } from "vite-plus/test";

import { splitQuickReplies } from "./QuickReplies.logic";

describe("splitQuickReplies", () => {
  it.each([
    [
      "Want me to set a reminder for 30 Nov?\n\nReplies: Yes, set it | No thanks",
      "Want me to set a reminder for 30 Nov?",
      ["Yes, set it", "No thanks"],
    ],
    ["Shall I?\nreplies:  Oui  |Non | Plus tard \n\n", "Shall I?", ["Oui", "Non", "Plus tard"]],
    ["Ready?\nREPLIES: Go", "Ready?", ["Go"]],
    ["Replies: Yes | No", "", ["Yes", "No"]],
  ])("takes the closing line off %j", (text, body, replies) => {
    expect(splitQuickReplies(text)).toEqual({ body, replies });
  });

  it.each([
    ["no such line", "All done."],
    ["a line that is not the last", "Replies: Yes | No\nAnything else?"],
    ["four replies", "Pick one.\nReplies: a | b | c | d"],
    ["an empty reply", "Pick one.\nReplies: a | | c"],
    ["no replies", "Pick one.\nReplies:"],
    ["a reply over 40 characters", `Pick one.\nReplies: ${"x".repeat(41)} | No`],
    ["the label inside a sentence", "Pick one.\nHere are my replies: a | b"],
    ["an unfinished label once the message is whole", "Pick one.\nRep"],
  ])("leaves a message with %s untouched", (_name, text) => {
    expect(splitQuickReplies(text)).toEqual({ body: text, replies: [] });
  });

  it("holds back the line while it streams, and offers nothing until the message is whole", () => {
    for (const tail of ["R", "Repl", "Replies:", "Replies: Yes, se", "Replies: Yes | No"]) {
      expect(splitQuickReplies(`Shall I?\n\n${tail}`, true)).toEqual({
        body: "Shall I?",
        replies: [],
      });
    }
    expect(splitQuickReplies("Shall I?\n\nRemember", true).body).toBe("Shall I?\n\nRemember");
    expect(splitQuickReplies("Shall I?\n\n", true).body).toBe("Shall I?\n\n");
  });
});
