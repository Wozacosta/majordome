import { describe, expect, it } from "vite-plus/test";

import { chatSubtitle, newChatStart, showsComputerChoice } from "./newChat.logic";

const vault = { environmentId: "mac", projectId: "notes" };

describe("newChatStart", () => {
  it("starts in the notes folder whatever was open last", () => {
    expect(newChatStart({ vault, resumesDraft: false, stillLoading: true })).toEqual({
      kind: "notes",
      environmentId: "mac",
      projectId: "notes",
    });
  });

  it("leaves a saved draft where it was written", () => {
    expect(newChatStart({ vault, resumesDraft: true, stillLoading: false }).kind).toBe("draft");
    expect(newChatStart({ vault: null, resumesDraft: true, stillLoading: true }).kind).toBe(
      "draft",
    );
  });

  it("waits while the computer is still being asked, then says the folder is missing", () => {
    expect(newChatStart({ vault: null, resumesDraft: false, stillLoading: true }).kind).toBe(
      "looking",
    );
    expect(newChatStart({ vault: null, resumesDraft: false, stillLoading: false }).kind).toBe(
      "missing",
    );
  });
});

describe("showsComputerChoice", () => {
  it("offers the computer only when there are several", () => {
    expect([0, 1, 2].map(showsComputerChoice)).toEqual([false, false, true]);
  });
});

describe("chatSubtitle", () => {
  it("is empty with one computer and nothing else to say", () => {
    expect(chatSubtitle({ computerLabel: "MacBook", computerCount: 1, origin: null })).toBe("");
  });

  it("names the computer when there are several, then where the chat came from", () => {
    expect(chatSubtitle({ computerLabel: "MacBook", computerCount: 2, origin: null })).toBe(
      "MacBook",
    );
    expect(
      chatSubtitle({ computerLabel: "MacBook", computerCount: 2, origin: "From Server" }),
    ).toBe("MacBook · From Server");
    expect(chatSubtitle({ computerLabel: null, computerCount: 1, origin: "From Server" })).toBe(
      "From Server",
    );
  });
});
