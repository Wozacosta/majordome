import { expect, it } from "vite-plus/test";

import { describePlatform, problemReportUrl } from "./help.logic";

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const WINDOWS_FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0";

it("names where the app runs in a few words", () => {
  expect(describePlatform({ userAgent: MAC_CHROME, desktopApp: true, homeScreen: false })).toBe(
    "Desktop app on macOS",
  );
  expect(describePlatform({ userAgent: MAC_CHROME, desktopApp: false, homeScreen: false })).toBe(
    "Chrome on macOS",
  );
  expect(describePlatform({ userAgent: IPHONE_SAFARI, desktopApp: false, homeScreen: true })).toBe(
    "Safari on iOS, from the Home Screen",
  );
  expect(
    describePlatform({ userAgent: WINDOWS_FIREFOX, desktopApp: false, homeScreen: false }),
  ).toBe("Firefox on Windows");
  expect(describePlatform({ userAgent: "", desktopApp: false, homeScreen: false })).toBe(
    "A browser",
  );
});

it("opens a problem report that carries the version and the platform, and nothing else", () => {
  const url = new URL(
    problemReportUrl("0.10.77", { userAgent: MAC_CHROME, desktopApp: true, homeScreen: false }),
  );
  expect(`${url.origin}${url.pathname}`).toBe("https://github.com/Wozacosta/majordome/issues/new");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    template: "majordome-problem.yml",
    version: "0.10.77",
    environment: "Desktop app on macOS",
  });
});
