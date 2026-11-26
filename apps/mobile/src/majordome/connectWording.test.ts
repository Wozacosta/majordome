import { describe, expect, it } from "vite-plus/test";

import {
  accountConnectErrorForOwner,
  connectErrorForOwner,
  signOutQuestion,
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

describe("signOutQuestion", () => {
  const mac = { environmentId: "mac", name: "Samy's Mac" };
  const server = { environmentId: "server", name: "Majordome server" };

  it("asks nothing when this phone is connected to none of the account's computers", () => {
    expect(signOutQuestion([mac], {})).toBeNull();
    expect(signOutQuestion([], { other: {} })).toBeNull();
  });

  it("names only the account's computers this phone is connected to", () => {
    const question = signOutQuestion([mac, server], { mac: {}, scanned: {} });
    expect(question?.environmentIds).toEqual(["mac"]);
    expect(question?.message).toMatch(/connected to Samy's Mac\. Disconnect it too\?/);
  });

  it("names several", () => {
    const question = signOutQuestion([mac, server], { mac: {}, server: {} });
    expect(question?.environmentIds).toEqual(["mac", "server"]);
    expect(question?.message).toMatch(/Samy's Mac and Majordome server\. Disconnect them too\?/);
  });
});
