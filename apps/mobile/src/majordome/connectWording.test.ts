import { describe, expect, it } from "vite-plus/test";

import { connectErrorForOwner } from "./connectWording";

describe("connectErrorForOwner", () => {
  it.each([
    ["That pairing code is unknown, expired, or already used.", /press “Show the code” again/],
    ["That is not a one-time pairing code.", /press “Show the code” again/],
    [
      "Failed to fetch remote environment endpoint https://x.majord.link/api/auth (TypeError: Network request failed).",
      /didn't answer at that address/,
    ],
    ["Remote environment endpoint https://x/api timed out after 10000ms.", /didn't answer/],
  ])("says what to do about %j", (message, expected) => {
    expect(connectErrorForOwner(message)).toMatch(expected);
  });

  it("shows an answer it does not recognise as it came", () => {
    const message = "That address reaches Studio, a different machine.";
    expect(connectErrorForOwner(message)).toBe(message);
  });
});
