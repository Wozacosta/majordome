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
  });
});

it("falls back to the newest released version, never to what is not released yet", () => {
  expect(whatsNewFromChangelog(CHANGELOG, "0.1.12")).toEqual({
    version: "0.10.2",
    notes: "**New**\n\n- **A thing.** It does\n  something.",
  });
});

it("has nothing to show without a released version", () => {
  expect(
    whatsNewFromChangelog("# What's new\n\n## Next\n\nNot released yet.\n", "1.0.0"),
  ).toBeNull();
});
