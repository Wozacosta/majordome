import { EnvironmentId, type MajordomeRoutinesRunner } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  anywhereView,
  base64UrlToBytes,
  computerSetupProgress,
  currentAnywhere,
  deviceLabel,
  devicePushSupport,
  isAppleMobileDevice,
  isOnPhone,
  notificationsProblem,
  pairedPhones,
  phoneAddress,
  phoneAppPairingLink,
  phoneComputerWords,
  phoneEnvironmentId,
  phoneSignIn,
  phoneStepStates,
  phoneWays,
  phoneWithNotifications,
  subscriptionUsesKey,
} from "./phone.logic";

const desktop = {
  isSecureContext: true,
  hasServiceWorker: true,
  hasPushManager: true,
  isAppleMobile: false,
  isStandalone: false,
};

describe("devicePushSupport", () => {
  it.each([
    ["a desktop browser over HTTPS or localhost", desktop, "supported"],
    ["a plain-HTTP Wi-Fi address", { ...desktop, isSecureContext: false }, "insecure"],
    [
      "iPhone Safari, not on the Home Screen",
      { ...desktop, isAppleMobile: true },
      "needs-home-screen",
    ],
    [
      "iPhone, opened from the Home Screen",
      { ...desktop, isAppleMobile: true, isStandalone: true },
      "supported",
    ],
    ["a browser without Push", { ...desktop, hasPushManager: false }, "unsupported"],
  ] as const)("%s", (_name, env, expected) => {
    expect(devicePushSupport(env)).toBe(expected);
  });
});

describe("isAppleMobileDevice", () => {
  it("tells an iPad that reports itself as a Mac from a real Mac", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
    expect(isAppleMobileDevice(mac, 5)).toBe(true);
    expect(isAppleMobileDevice(mac, 0)).toBe(false);
    expect(isAppleMobileDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe(
      true,
    );
  });
});

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";

describe("deviceLabel", () => {
  it.each([
    [IPHONE_SAFARI, 5, "iPhone · Safari"],
    [MAC_CHROME, 0, "Mac · Chrome"],
    [MAC_SAFARI, 5, "iPad · Safari"],
    [ANDROID_CHROME, 5, "Android · Chrome"],
    [WINDOWS_EDGE, 0, "Windows · Edge"],
    ["curl/8.0", 0, undefined],
  ] as const)("%s", (userAgent, touchPoints, expected) => {
    expect(deviceLabel(userAgent, touchPoints)).toBe(expected);
  });
});

describe("isOnPhone", () => {
  const phone = {
    userAgent: IPHONE_SAFARI,
    maxTouchPoints: 5,
    isStandalone: false,
    isSecureContext: true,
  };
  const computer = { ...phone, userAgent: MAC_CHROME, maxTouchPoints: 0 };
  it.each([
    ["a phone on the secure address", phone, true],
    ["a phone browser on the Wi-Fi address", { ...phone, isSecureContext: false }, false],
    [
      "the installed app on a phone",
      { ...phone, isSecureContext: false, isStandalone: true },
      true,
    ],
    ["the computer on the secure address", computer, false],
    ["an app installed on the computer", { ...computer, isStandalone: true }, false],
  ] as const)("%s", (_name, input, expected) => {
    expect(isOnPhone(input)).toBe(expected);
  });
});

describe("phone setup checklist", () => {
  it.each([
    ["not-installed", [false, false, false]],
    ["signed-out", [false, false, false]],
    ["https-off", [true, false, false]],
    ["not-served", [true, true, false]],
    ["ready", [true, true, true]],
  ] as const)("ticks the computer's steps Tailscale reports as done: %s", (tailscale, expected) => {
    const progress = computerSetupProgress(tailscale);
    expect([progress.tailscaleOn, progress.secureAddressesOn, progress.majordomeReachable]).toEqual(
      expected,
    );
  });

  it("counts the last step done only once a phone or tablet gets notifications", () => {
    expect(phoneWithNotifications([{ label: "Mac · Chrome" }, { label: null }])).toBeNull();
    expect(phoneWithNotifications([{ label: "Mac · Chrome" }, { label: "Android · Chrome" }])).toBe(
      "Android · Chrome",
    );
    expect(phoneWithNotifications([{ label: deviceLabel(MAC_SAFARI, 5) ?? null }])).toBe(
      "iPad · Safari",
    );
  });

  it.each([
    ["nothing done", { paired: 0, notified: null }, ["todo", "unseen", "todo"]],
    ["access can't be seen", { paired: null, notified: null }, ["todo", "unseen", "todo"]],
    ["a phone scanned the code", { paired: 1, notified: null }, ["done", "unseen", "todo"]],
    [
      "an Android phone gets notifications",
      { paired: 1, notified: "Android · Chrome" },
      ["done", "unseen", "done"],
    ],
    [
      "an iPhone gets notifications, which needs the Home Screen",
      { paired: null, notified: "iPhone · Safari" },
      ["done", "done", "done"],
    ],
  ] as const)("marks each phone step on its own evidence: %s", (_name, input, expected) => {
    const steps = phoneStepStates(input);
    expect([steps.open, steps.homeScreen, steps.notifications]).toEqual(expected);
  });

  it("lists the phones that can open Majordome, never the device asking", () => {
    const session = (
      sessionId: string,
      client: Parameters<typeof pairedPhones>[0][number]["client"],
      current = false,
    ) => ({
      sessionId: sessionId as never,
      client,
      issuedAt: DateTime.makeUnsafe(1_000),
      connected: sessionId === "a",
      current,
    });
    expect(
      pairedPhones([
        session("a", { label: "Phone", deviceType: "mobile", os: "iOS", browser: "Safari" }),
        session("b", { label: "Phone", deviceType: "unknown" }),
        session("c", { deviceType: "tablet", os: "Android" }),
        session("d", { deviceType: "desktop", os: "macOS" }),
        session("e", { label: "Phone", deviceType: "mobile" }, true),
        session("f", { label: "Phone", deviceType: "mobile", os: "iOS" }),
      ]),
    ).toEqual([
      { sessionId: "a", name: "iPhone, Safari", addedAt: 1_000, connected: true },
      { sessionId: "b", name: "A phone", addedAt: 1_000, connected: false },
      { sessionId: "c", name: "Android tablet, Majordome app", addedAt: 1_000, connected: false },
      { sessionId: "f", name: "iPhone, Majordome app", addedAt: 1_000, connected: false },
    ]);
  });
});

describe("why notifications can't be turned on", () => {
  const ok = { canSave: true, key: "ready", permission: "default", on: false } as const;
  it.each([
    ["nothing is wrong", ok, null],
    ["the key is still loading", { ...ok, key: "loading" }, null],
    ["Majordome did not answer", { ...ok, key: "failed" }, "unreachable"],
    ["the device blocked them", { ...ok, key: "failed", permission: "denied" }, "blocked"],
    ["the device can only read", { ...ok, canSave: false, permission: "denied" }, "read-only"],
    ["they are already on", { ...ok, on: true, canSave: false, key: "failed" }, null],
  ] as const)("%s", (_name, input, expected) => {
    expect(notificationsProblem(input)).toBe(expected);
  });
});

describe("the address from anywhere", () => {
  const URL = "https://k7m2xq9d.majord.link";
  const off = { state: "off", url: null, reason: null } as const;
  const starting = { state: "starting", url: null, reason: null } as const;
  const ready = { state: "ready", url: URL, reason: null } as const;
  const unavailable = { state: "unavailable", url: null, reason: "No helper." } as const;

  it.each([
    ["off", off, false, { kind: "offer" }],
    ["off, while the command runs", off, true, { kind: "starting" }],
    ["still connecting", starting, false, { kind: "starting" }],
    ["ready", ready, false, { kind: "ready", address: URL }],
    ["ready before its address is known", { ...ready, url: null }, false, { kind: "starting" }],
    ["unavailable", unavailable, false, { kind: "unavailable", reason: "No helper." }],
    ["unavailable, trying again", unavailable, true, { kind: "starting" }],
  ] as const)("shows %s", (_name, anywhere, enabling, expected) => {
    expect(anywhereView(anywhere, enabling)).toEqual(expected);
  });

  it("trusts a command's answer only while the setup is read again", () => {
    expect(currentAnywhere(off, ready, true)).toBe(ready);
    expect(currentAnywhere(off, ready, false)).toBe(off);
    expect(currentAnywhere(off, null, true)).toBe(off);
  });

  it.each([
    ["nothing set up", off, "not-installed", [false, false, false]],
    ["connecting", starting, "signed-out", [false, false, false]],
    ["anywhere in use", ready, "https-off", [false, false, false]],
    ["Tailscale already in use", off, "ready", [false, true, false]],
    ["both in use", ready, "ready", [false, false, true]],
    ["anywhere can't be had", unavailable, "not-installed", [true, false, false]],
  ] as const)("orders the two ways: %s", (_name, anywhere, tailscale, expected) => {
    const ways = phoneWays({ anywhere, tailscale });
    expect([ways.tailscaleOpen, ways.tailscaleOnly, ways.bothInUse]).toEqual(expected);
  });

  const owner = { accountId: "user_1", email: "sam@example.com" };
  it.each([
    ["a build with no accounts", false, { available: true, owner, address: URL }, null],
    ["a computer that has not answered", true, null, null],
    ["a computer with no accounts", true, { available: false, owner: null, address: null }, null],
    [
      "a computer in no account",
      true,
      { available: true, owner: null, address: URL },
      { kind: "needs-account" },
    ],
    [
      "a computer in an account, with no address",
      true,
      { available: true, owner, address: null },
      { kind: "needs-address" },
    ],
    [
      "a computer in an account, with an address",
      true,
      { available: true, owner, address: URL },
      { kind: "ready", email: "sam@example.com" },
    ],
  ] as const)(
    "puts signing in before the code only where there are accounts: %s",
    (_name, hasAccounts, account, expected) => {
      expect(phoneSignIn(hasAccounts, account)).toEqual(expected);
    },
  );

  it.each([
    ["anywhere first", ready, "ready", { way: "anywhere", url: URL }],
    ["Tailscale alone", off, "ready", { way: "tailscale", url: "https://mac.ts.net" }],
    ["still connecting", starting, "not-served", null],
    ["neither", unavailable, "not-installed", null],
  ] as const)(
    "names the address a phone uses away from home: %s",
    (_name, anywhere, tailscale, expected) => {
      expect(phoneAddress({ anywhere, tailscale, secureUrl: "https://mac.ts.net" })).toEqual(
        expected,
      );
    },
  );
});

describe("the computer a phone is set up on", () => {
  const mac = EnvironmentId.make("mac");
  const server = EnvironmentId.make("server");
  const other = EnvironmentId.make("other");
  const copy = (environmentId: EnvironmentId, routinesRunner: MajordomeRoutinesRunner) => ({
    environmentId,
    routinesRunner,
  });
  const runs = (environmentId: EnvironmentId) => copy(environmentId, "this-server");
  const follows = (environmentId: EnvironmentId) => copy(environmentId, "another-server");

  it.each([
    ["this computer runs the routines", [mac, server], [runs(mac), follows(server)], mac],
    ["another connected computer runs them", [mac, server], [follows(mac), runs(server)], server],
    ["the one that runs them is not connected", [mac], [follows(mac), runs(server)], mac],
    ["nothing runs routines", [mac, server], [copy(mac, "none"), copy(server, "none")], mac],
    [
      "two notes folders run on this computer and on another: the other one is always on",
      [mac, server],
      [runs(mac), runs(server)],
      server,
    ],
    [
      "two notes folders run on two other computers: the first folder's",
      [mac, server, other],
      [runs(other), runs(server)],
      other,
    ],
  ])("%s", (_name, connected, copies, expected) => {
    expect(phoneEnvironmentId({ primaryEnvironmentId: mac, connected, copies })).toBe(expected);
  });

  it("waits for this window's own computer", () => {
    expect(
      phoneEnvironmentId({
        primaryEnvironmentId: null,
        connected: [server],
        copies: [runs(server)],
      }),
    ).toBeNull();
  });

  it("names another computer and keeps “this computer” for this one", () => {
    expect(phoneComputerWords(null)).toEqual({
      inSentence: "this computer",
      atStart: "This computer",
    });
    expect(phoneComputerWords("Home server").inSentence).toBe("Home server");
    expect(phoneComputerWords("Your server")).toEqual({
      inSentence: "your server",
      atStart: "Your server",
    });
    expect(phoneComputerWords("Another computer")).toEqual({
      inSentence: "another computer",
      atStart: "Another computer",
    });
  });
});

describe("subscriptionUsesKey", () => {
  it("keeps a subscription made with this server's key and replaces any other", () => {
    const key = "BAECAwQ";
    expect([...base64UrlToBytes(key)]).toEqual([4, 1, 2, 3, 4]);
    expect(subscriptionUsesKey(base64UrlToBytes(key).buffer, key)).toBe(true);
    expect(subscriptionUsesKey(base64UrlToBytes("BAECAwU").buffer, key)).toBe(false);
    expect(subscriptionUsesKey(null, key)).toBe(false);
  });
});

it("wraps the pairing address, its code included, in the link that opens the phone app", () => {
  const link = new URL(phoneAppPairingLink("https://x.majord.link/pair#token=AB12"));
  expect(link.protocol).toBe("majordome:");
  expect(link.host + link.pathname).toBe("connections/new");
  expect(link.searchParams.get("pairingUrl")).toBe("https://x.majord.link/pair#token=AB12");
});
