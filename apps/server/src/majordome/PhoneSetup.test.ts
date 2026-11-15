import { describe, expect, it } from "@effect/vitest";

import { secureAddressTarget, tailscaleStateFromStatus } from "./PhoneSetup.ts";

const status = {
  running: true,
  magicDnsName: "laptop.tail1234.ts.net",
  tailnetIpv4Addresses: ["100.64.0.1"],
  httpsServeEnabled: true,
};

describe("tailscaleStateFromStatus", () => {
  it.each([
    ["no Tailscale CLI", "not-installed" as const, "not-installed"],
    ["a CLI that can't answer", "unreadable" as const, "signed-out"],
    ["Tailscale turned off", { ...status, running: false }, "signed-out"],
    ["no MagicDNS name", { ...status, magicDnsName: null }, "signed-out"],
    ["HTTPS certificates off", { ...status, httpsServeEnabled: false }, "https-off"],
    ["an older CLI that hides HTTPS", { ...status, httpsServeEnabled: null }, "maybe-served"],
    ["everything ready", status, "maybe-served"],
  ])("reads %s", (_name, input, expected) => {
    expect(tailscaleStateFromStatus(input)).toBe(expected);
  });
});

describe("secureAddressTarget", () => {
  it("forwards to the web dev server in development, which proxies the backend", () => {
    expect(
      secureAddressTarget({
        devUrl: new URL("http://localhost:5733/"),
        host: undefined,
        port: 3773,
      }),
    ).toEqual({ host: "localhost", port: 5733 });
  });

  it("forwards to the address the server listens on", () => {
    expect(secureAddressTarget({ devUrl: undefined, host: "0.0.0.0", port: 3773 })).toEqual({
      host: "127.0.0.1",
      port: 3773,
    });
    expect(secureAddressTarget({ devUrl: undefined, host: "100.64.0.1", port: 3773 })).toEqual({
      host: "100.64.0.1",
      port: 3773,
      urlHost: "100.64.0.1",
    });
  });
});
