import { expect, it } from "vite-plus/test";

import { savedKeyLine, savedKeyNameFrom } from "./majordomeSavedKeys.ts";

it("names a key the way the server's key file accepts", () => {
  expect(savedKeyNameFrom("  Garmin API key ")).toBe("garmin-api-key");
  expect(savedKeyNameFrom("strava.token_2")).toBe("strava.token_2");
  expect(savedKeyNameFrom("-Clé d'accès!")).toBe("cl-d-acc-s");
  expect(savedKeyNameFrom("???")).toBe("");
});

it("says what a key is for and when it was last used", () => {
  expect(savedKeyLine({ note: "" })).toBe("Not used yet");
  expect(
    savedKeyLine({ note: "Garmin token", lastUsedAt: "2026-11-03T10:00:00.000Z" }, "en-GB", "UTC"),
  ).toBe("Garmin token · Last used 3 Nov 2026");
});
