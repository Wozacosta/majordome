import { describe, expect, it } from "vite-plus/test";

import {
  type ComputerConnection,
  type ComputerState,
  computerState,
  computerStateText,
} from "./connectionState";

const connection = (over: Partial<ComputerConnection>): ComputerConnection => ({
  enabled: true,
  phase: "reconnecting",
  network: "online",
  failure: null,
  ...over,
});

describe("computerState", () => {
  it.each<[string, Partial<ComputerConnection>, ComputerState | null]>([
    ["connected", { phase: "connected" }, null],
    ["switched off, whatever else", { enabled: false, phase: "connected" }, "switchedOff"],
    ["first attempt", { phase: "connecting" }, "connecting"],
    ["retrying with no failure yet", { phase: "reconnecting" }, "connecting"],
    ["the phone has no network", { network: "offline" }, "phoneOffline"],
    ["upstream's offline phase", { phase: "offline", network: "unknown" }, "phoneOffline"],
    [
      "offline wins over an old failure",
      { network: "offline", failure: { reason: "authentication" } },
      "phoneOffline",
    ],
    ["nobody answered", { failure: { reason: "timeout" } }, "unreachable"],
    ["network error", { phase: "error", failure: { reason: "network" } }, "unreachable"],
    ["saved but idle", { phase: "available" }, "notConnected"],
    ["refused sign-in", { phase: "error", failure: { reason: "authentication" } }, "signInExpired"],
    ["refused permission", { phase: "error", failure: { reason: "permission" } }, "signInExpired"],
    [
      "a refusal caused by the clock",
      { phase: "error", failure: { reason: "authentication", failureCause: "clock_skew" } },
      "clockWrong",
    ],
    [
      "the computer must update",
      { phase: "error", failure: { reason: "unsupported", serverUpdateRequired: true } },
      "computerOutdated",
    ],
    ["the app must update", { phase: "unsupported", failure: null }, "appOutdated"],
    ["waiting for approval", { failure: { reason: "approval-pending" } }, "waitingForApproval"],
  ])("%s", (_name, over, expected) => {
    expect(computerState(connection(over))).toBe(expected);
  });
});

describe("computerStateText", () => {
  const states: ComputerState[] = [
    "switchedOff",
    "phoneOffline",
    "connecting",
    "notConnected",
    "waitingForApproval",
    "unreachable",
    "signInExpired",
    "clockWrong",
    "computerOutdated",
    "appOutdated",
  ];

  it("offers something to do for every state that is not just waiting", () => {
    const waiting = states.filter((state) => computerStateText(state, "Mac").action === null);
    expect(waiting).toEqual(["connecting", "waitingForApproval"]);
  });

  it("sends an expired sign-in to a new code and an old computer to its page", () => {
    expect(computerStateText("signInExpired", "Mac").action?.does).toBe("pairAgain");
    expect(computerStateText("computerOutdated", "Mac").action?.does).toBe("openComputer");
    expect(computerStateText("switchedOff", "Mac").action?.does).toBe("switchOn");
  });

  it.each(states)("says %s without upstream's words", (state) => {
    expect(computerStateText(state, "Mac").sentence).not.toMatch(
      /environment|host|server|route|tunnel|relay|device|T3/i,
    );
  });
});
