import { expect, it } from "vite-plus/test";

import { whatsNewFromChangelog } from "./majordomeWhatsNew";

const CHANGELOG = `# What's new

Newest first.

## Next

Not released yet.

## 0.10.2

**New**

- **A thing.** It does
  something.

## 0.10.1

**Fixed**

- An older thing.
`;

it("reads the notes of the version the build is", () => {
  expect(whatsNewFromChangelog(CHANGELOG, "0.10.1")).toEqual({
    version: "0.10.1",
    notes: "**Fixed**\n\n- An older thing.",
    earlier: [],
  });
});

it("falls back to the newest released version, never to what is not released yet", () => {
  expect(whatsNewFromChangelog(CHANGELOG, "0.1.12")).toEqual({
    version: "0.10.2",
    notes: "**New**\n\n- **A thing.** It does\n  something.",
    earlier: [{ version: "0.10.1", notes: "**Fixed**\n\n- An older thing." }],
  });
});

it("has nothing to show without a released version", () => {
  expect(
    whatsNewFromChangelog("# What's new\n\n## Next\n\nNot released yet.\n", "1.0.0"),
  ).toBeNull();
});

it("carries the few versions before the one shown, newest first", () => {
  const changelog = ["## Next", "", "Soon."]
    .concat(
      [9, 8, 7, 6, 5, 4, 3, 2, 1].flatMap((patch) => [`## 1.0.${patch}`, "", `- Fix ${patch}.`]),
    )
    .join("\n");
  expect(
    whatsNewFromChangelog(changelog, "1.0.8")?.earlier.map((section) => section.version),
  ).toEqual(["1.0.7", "1.0.6", "1.0.5", "1.0.4", "1.0.3"]);
});
