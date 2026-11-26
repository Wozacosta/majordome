import type { MajordomeSavedKey } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mergeSavedKeys,
  savedKeyDayFrom,
  savedKeyLine,
  savedKeyNameFrom,
  savedKeyPlaceLine,
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

describe("the keys of several computers as one list", () => {
  const key = (name: string, extra: Partial<MajordomeSavedKey> = {}): MajordomeSavedKey => ({
    name,
    note: "",
    ...extra,
  });
  const nameOf = (id: string) => (id === "server" ? "your server" : "this Mac");

  it("lists each name once and says nothing about a key every computer holds", () => {
    const rows = mergeSavedKeys([
      { id: "server", keys: [key("garmin", { note: "Runs", lastUsedAt: "2026-11-20T10:00:00Z" })] },
      { id: "mac", keys: [key("garmin", { note: "Old", lastUsedAt: "2026-11-24T10:00:00Z" })] },
    ]);
    expect(rows).toHaveLength(1);
    // The details of the computer listed first, last used when either last used it.
    expect(rows[0]).toMatchObject({
      note: "Runs",
      lastUsedAt: "2026-11-24T10:00:00Z",
      on: ["server", "mac"],
      missing: [],
    });
    expect(savedKeyPlaceLine(rows[0]!, nameOf, "server")).toBeNull();
  });

  it("says where a key is missing, and that the chats cannot use one their computer lacks", () => {
    const rows = mergeSavedKeys([
      { id: "server", keys: [key("stripe")] },
      { id: "mac", keys: [key("myage"), key("notion", { source: "Mac Keychain" })] },
    ]);
    const line = (name: string) =>
      savedKeyPlaceLine(
        rows.find((row) => row.name === name)!,
        nameOf,
        "server",
      );
    expect(rows.map((row) => row.name)).toEqual(["myage", "notion", "stripe"]);
    expect(line("myage")).toBe(
      "Only on this Mac. Chats answered on your server can't use it: save it again to have it everywhere.",
    );
    expect(line("stripe")).toBe("Only on your server. Save it again to have it everywhere.");
    // A key kept in a source cannot be copied, so nothing is asked of the owner.
    expect(line("notion")).toBe("Only on this Mac.");
  });

  it("does not call a key missing on a computer whose keys could not be read", () => {
    const rows = mergeSavedKeys([
      { id: "server", keys: null },
      { id: "mac", keys: [key("myage")] },
    ]);
    expect(rows[0]).toMatchObject({ on: ["mac"], missing: [] });
    expect(savedKeyPlaceLine(rows[0]!, nameOf, "server")).toBeNull();
  });
});
