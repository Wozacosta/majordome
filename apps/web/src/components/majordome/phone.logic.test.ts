import { describe, expect, it } from "vite-plus/test";

import {
  base64UrlToBytes,
  devicePushSupport,
  isAppleMobileDevice,
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

describe("subscriptionUsesKey", () => {
  it("keeps a subscription made with this server's key and replaces any other", () => {
    const key = "BAECAwQ";
    expect([...base64UrlToBytes(key)]).toEqual([4, 1, 2, 3, 4]);
    expect(subscriptionUsesKey(base64UrlToBytes(key).buffer, key)).toBe(true);
    expect(subscriptionUsesKey(base64UrlToBytes("BAECAwU").buffer, key)).toBe(false);
    expect(subscriptionUsesKey(null, key)).toBe(false);
  });
});
