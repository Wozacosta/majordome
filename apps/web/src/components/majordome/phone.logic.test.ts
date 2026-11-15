import { describe, expect, it } from "vite-plus/test";

import {
  base64UrlToBytes,
  deviceLabel,
  devicePushSupport,
  isAppleMobileDevice,
  isOnPhone,
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

describe("subscriptionUsesKey", () => {
  it("keeps a subscription made with this server's key and replaces any other", () => {
    const key = "BAECAwQ";
    expect([...base64UrlToBytes(key)]).toEqual([4, 1, 2, 3, 4]);
    expect(subscriptionUsesKey(base64UrlToBytes(key).buffer, key)).toBe(true);
    expect(subscriptionUsesKey(base64UrlToBytes("BAECAwU").buffer, key)).toBe(false);
    expect(subscriptionUsesKey(null, key)).toBe(false);
  });
});
