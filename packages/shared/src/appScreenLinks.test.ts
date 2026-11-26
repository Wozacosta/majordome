import { describe, expect, it } from "vite-plus/test";

import { appScreenHref, formatAppScreenLink, parseAppScreenHref } from "./appScreenLinks.ts";

describe("parseAppScreenHref", () => {
  it.each([
    ["app://settings/phone", "/settings/phone"],
    ["app://routines", "/routines"],
    ["app://settings/always-on/", "/settings/always-on"],
    ["app://", null],
    ["app://settings/../secrets", null],
    ["app://settings/phone?x=1", null],
    ["app://Settings/Phone", null],
    ["https://example.com/settings/phone", null],
    ["/settings/phone", null],
  ])("reads %s as %s", (href, expected) => {
    expect(parseAppScreenHref(href)).toBe(expected);
  });

  it("reads back the link it writes", () => {
    expect(parseAppScreenHref(appScreenHref("/settings/phone"))).toBe("/settings/phone");
    expect(formatAppScreenLink("Phone & notifications", "/settings/phone")).toBe(
      "[Phone & notifications](app://settings/phone)",
    );
  });
});
