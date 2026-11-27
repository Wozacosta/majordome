import { describe, expect, it } from "vite-plus/test";

import {
  accountConnectErrorForOwner,
  connectErrorForOwner,
  welcomeAccountRow,
} from "./connectWording";

describe("connectErrorForOwner", () => {
  it.each([
    ["That pairing code is unknown, expired, or already used.", /press “Show the code” again/],
    ["That is not a one-time pairing code.", /press “Show the code” again/],
    [
      "Failed to fetch remote environment endpoint https://x.majord.link/api/auth (TypeError: Network request failed).",
      /didn't answer at that address/,
    ],
    ["Remote environment endpoint https://x/api timed out after 10000ms.", /didn't answer/],
    [
      "Your computer took too long to answer at http://10.9.9.9:1/.well-known/t3/environment. Check that it is on and that Majordome is open on it.",
      /^Your computer didn't answer at that address/,
    ],
    [
      "Your computer didn't answer at http://10.9.9.9:1/.well-known/t3/environment. Check that it is on and that Majordome is open on it.",
      /^Your computer didn't answer at that address/,
    ],
  ])("says what to do about %j", (message, expected) => {
    expect(connectErrorForOwner(message)).toMatch(expected);
  });

  it("shows an answer it does not recognise as it came", () => {
    const message = "That address reaches Studio, a different machine.";
    expect(connectErrorForOwner(message)).toBe(message);
  });
});

describe("accountConnectErrorForOwner", () => {
  it.each([
    ["Remote environment endpoint https://x/api timed out after 10000ms.", /^Studio didn't answer/],
    ["That pairing code is unknown, expired, or already used.", /Press Connect again/],
    ["That address reaches Den, a different machine.", /^That address reaches Den/],
  ])("names the computer and never asks for an address or a code: %j", (message, expected) => {
    const said = accountConnectErrorForOwner(message, "Studio");
    expect(said).toMatch(expected);
    expect(said).not.toMatch(/Show the code|the address is the one/);
  });
});

describe("welcomeAccountRow", () => {
  it("asks only someone signed out to sign in", () => {
    expect(welcomeAccountRow({ signedIn: false, email: null, computers: [] }).title).toBe(
      "Sign in",
    );
    for (const computers of [[], ["Studio"], ["Studio", "Den"]]) {
      const row = welcomeAccountRow({ signedIn: true, email: "ada@example.com", computers });
      expect(row.title).not.toMatch(/sign in/i);
      expect(row.detail).toBe("ada@example.com");
    }
  });

  it("offers the computer the account lists, and stays quiet when it lists none", () => {
    const signedIn = { signedIn: true, email: null };
    expect(welcomeAccountRow({ ...signedIn, computers: [] })).toEqual({
      title: "Your account",
      detail: "Signed in",
      main: false,
    });
    expect(welcomeAccountRow({ ...signedIn, computers: ["Studio"] })).toMatchObject({
      title: "Connect to Studio",
      main: true,
    });
    expect(welcomeAccountRow({ ...signedIn, computers: ["Studio", "Den"] }).title).toBe(
      "Connect your computers",
    );
  });
});
