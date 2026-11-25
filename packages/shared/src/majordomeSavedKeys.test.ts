import { expect, it } from "vite-plus/test";

import {
  savedKeyDayFrom,
  savedKeyLine,
  savedKeyNameFrom,
  savedKeyStanding,
} from "./majordomeSavedKeys.ts";

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
  expect(savedKeyLine({ note: "Runs", source: "My Bitwarden" })).toBe(
    "Runs · Kept in My Bitwarden · Not used yet",
  );
  expect(savedKeyLine({ note: "", signsInTo: "My Bitwarden" })).toBe(
    "Signs Majordome in to My Bitwarden. Your assistant cannot take it.",
  );
});

it("reads a key's last day from a day or from how long it lasts", () => {
  const now = Date.parse("2026-11-25T21:00:00Z");
  expect(savedKeyDayFrom(" 2027-11-25 ", now)).toBe("2027-11-25");
  expect(savedKeyDayFrom("5/3/2027", now)).toBe("2027-03-05");
  expect(savedKeyDayFrom("1 year", now)).toBe("2027-11-25");
  expect(savedKeyDayFrom("90 days", now)).toBe("2027-02-23");
  expect(savedKeyDayFrom("2 weeks", now)).toBe("2026-12-09");
  // The end of a shorter month, not the start of the one after.
  expect(savedKeyDayFrom("1 month", Date.parse("2027-01-31T08:00:00Z"))).toBe("2027-02-28");
  expect(savedKeyDayFrom("2027-02-30", now)).toBeNull();
  expect(savedKeyDayFrom("0 days", now)).toBeNull();
  expect(savedKeyDayFrom("next spring", now)).toBeNull();
});

it("says where a key stands against its last day", () => {
  const now = Date.parse("2026-11-25T21:00:00Z");
  expect(savedKeyStanding({}, now)).toBe("open");
  expect(savedKeyStanding({ expiresOn: "2027-11-25" }, now)).toBe("good");
  expect(savedKeyStanding({ expiresOn: "2026-12-25" }, now)).toBe("soon");
  // It still works on its last day.
  expect(savedKeyStanding({ expiresOn: "2026-11-25" }, now)).toBe("soon");
  expect(savedKeyStanding({ expiresOn: "2026-11-24" }, now)).toBe("over");
  expect(savedKeyLine({ note: "Runs", expiresOn: "2027-11-25" }, "en-GB", "UTC", now)).toBe(
    "Runs · Works until 25 Nov 2027 · Not used yet",
  );
  expect(savedKeyLine({ note: "", expiresOn: "2026-11-24" }, "en-GB", "UTC", now)).toBe(
    "Stopped working 24 Nov 2026 · Not used yet",
  );
});
