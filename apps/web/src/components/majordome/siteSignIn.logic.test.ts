import type { BrowserImportSource } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  blockedSignInSources,
  looksLikeSignInPage,
  signInSources,
  siteLabel,
  siteOfUrl,
} from "./siteSignIn.logic";

const sources: ReadonlyArray<BrowserImportSource> = [
  {
    id: "chrome",
    name: "Chrome",
    unavailable: "browserRunning",
    profiles: [
      { directory: "Default", name: "Personal" },
      { directory: "Profile 1", name: "Work" },
    ],
  },
  { id: "safari", name: "Safari", unavailable: "needsFullDiskAccess", profiles: [] },
  { id: "firefox", name: "Firefox", profiles: [{ directory: "abc.default", name: "default" }] },
  { id: "edge", name: "Edge", unavailable: "notInstalled", profiles: [] },
];

it("names the site of a web page only", () => {
  expect(siteOfUrl("https://www.github.com/settings?tab=1")).toBe("www.github.com");
  expect(siteLabel("www.github.com")).toBe("github.com");
  expect(siteOfUrl("about:blank")).toBeNull();
  expect(siteOfUrl("file:///etc/passwd")).toBeNull();
  expect(siteOfUrl("not a url")).toBeNull();
  expect(siteOfUrl(null)).toBeNull();
});

it("offers the profiles that can be read, an open browser included, the last one first", () => {
  expect(signInSources(sources, null).map((source) => source.label)).toEqual([
    "Chrome, Personal",
    "Chrome, Work",
    "Firefox",
  ]);
  expect(signInSources(sources, "firefox\nabc.default")[0]?.label).toBe("Firefox");
  expect(blockedSignInSources(sources).map((source) => source.name)).toEqual(["Safari"]);
});

it("spots a page that asks to sign in from its address", () => {
  for (const url of [
    "https://github.com/login",
    "https://github.com/session",
    "https://accounts.google.com/v3/signin/identifier",
    "https://www.linkedin.com/login/fr",
    "https://app.example.com/users/sign_in?next=%2F",
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    "https://example.com/auth/sign-in",
  ]) {
    expect(looksLikeSignInPage(url), url).toBe(true);
  }
  for (const url of [
    "https://github.com/",
    "https://github.com/Wozacosta/majordome",
    "https://example.com/blog/logins-are-hard",
    "https://example.com/author/jane",
    "about:blank",
    null,
  ]) {
    expect(looksLikeSignInPage(url), String(url)).toBe(false);
  }
});
