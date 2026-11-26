import { expect, it } from "vite-plus/test";

import { isFreshInstall } from "./freshInstall.logic";

it("is a fresh install only when the phone holds nothing from an earlier run", () => {
  expect(isFreshInstall({ mark: false, database: false })).toBe(true);
});

it("leaves alone a phone that ran a version from before the mark existed", () => {
  expect(isFreshInstall({ mark: false, database: true })).toBe(false);
});

it("leaves alone a phone that already has the mark", () => {
  expect(isFreshInstall({ mark: true, database: false })).toBe(false);
  expect(isFreshInstall({ mark: true, database: true })).toBe(false);
});
