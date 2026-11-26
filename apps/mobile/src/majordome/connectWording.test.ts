import { describe, expect, it } from "vite-plus/test";

import {
  accountComputersOnThisPhone,
  accountConnectErrorForOwner,
  connectErrorForOwner,
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

describe("accountComputersOnThisPhone", () => {
  const mac = { environmentId: "mac", name: "Samy's Mac" };
  const server = { environmentId: "server", name: "Majordome server" };

  it("is empty when this phone is connected to none of the account's computers", () => {
    expect(accountComputersOnThisPhone([mac], {})).toEqual([]);
    expect(accountComputersOnThisPhone([], { scanned: {} })).toEqual([]);
  });

  it("leaves out a computer paired by code that is not in the account", () => {
    expect(accountComputersOnThisPhone([mac, server], { mac: {}, scanned: {} })).toEqual(["mac"]);
  });

  it("lists every computer of the account this phone is connected to", () => {
    expect(accountComputersOnThisPhone([mac, server], { mac: {}, server: {} })).toEqual([
      "mac",
      "server",
    ]);
  });
});
