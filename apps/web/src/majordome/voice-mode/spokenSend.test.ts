import { describe, expect, it } from "vite-plus/test";

import { armSpokenSend, spokenSend, spokenSendSettled } from "./spokenSend";

describe("spoken sends", () => {
  it("marks only the armed chat's next message, and says which one left", () => {
    const armed = armSpokenSend("env:a");
    expect(spokenSend("env:b", "m0")).toEqual({});
    expect(spokenSend("env:a", "m1")).toEqual({ replyStyle: "spoken" });
    spokenSendSettled("m1", true);
    expect(armed.messageId()).toBe("m1");
    // A message typed afterwards in the same chat is not spoken.
    expect(spokenSend("env:a", "m2")).toEqual({});
    armed.disarm();
  });

  it("forgets a message that did not arrive", () => {
    const armed = armSpokenSend("env:a");
    spokenSend("env:a", "m1");
    spokenSendSettled("m1", false);
    expect(armed.messageId()).toBeNull();
  });

  it("marks nothing once disarmed", () => {
    const armed = armSpokenSend("env:a");
    armed.disarm();
    expect(spokenSend("env:a", "m1")).toEqual({});
    expect(armed.messageId()).toBeNull();
  });
});
