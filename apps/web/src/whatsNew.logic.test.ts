import { expect, it } from "vite-plus/test";

import {
  isFirstLaunchAfterUpdate,
  notesSeenAtLaunch,
  parseWhatsNewNotes,
  splitWhatsNewInline,
} from "./whatsNew.logic";

it("groups a version's notes under their titles and joins wrapped bullets", () => {
  expect(
    parseWhatsNewNotes(
      "**New**\n\n- **A key icon** opens the page,\n  next to Settings.\n- Another.\n\n**Try this**\n\n- Click the key.",
    ),
  ).toEqual([
    { title: "New", items: ["**A key icon** opens the page, next to Settings.", "Another."] },
    { title: "Try this", items: ["Click the key."] },
  ]);
});

it("keeps notes written without a title or a bullet", () => {
  expect(parseWhatsNewNotes("A small release.\n\n- One fix.")).toEqual([
    { title: null, items: ["A small release.", "One fix."] },
  ]);
});

it("splits bold, code and links out of a line", () => {
  expect(splitWhatsNewInline("**Bold.** Run `majord` or read [the guide](https://a.b/c).")).toEqual(
    [
      { kind: "bold", text: "Bold." },
      { kind: "text", text: " Run " },
      { kind: "code", text: "majord" },
      { kind: "text", text: " or read " },
      { kind: "link", text: "the guide", href: "https://a.b/c" },
      { kind: "text", text: "." },
    ],
  );
});

it("announces an update once, and never a first launch", () => {
  expect(isFirstLaunchAfterUpdate(null, "0.10.2")).toBe(false);
  expect(isFirstLaunchAfterUpdate("0.10.1", "0.10.2")).toBe(true);
  expect(isFirstLaunchAfterUpdate("0.10.2", "0.10.2")).toBe(false);
});

it("counts notes as unread after an update until they are opened, never on a first launch", () => {
  expect(notesSeenAtLaunch(null, null, "0.10.2")).toBe("0.10.2");
  // Updated from a version that did not record which notes were read.
  expect(notesSeenAtLaunch(null, "0.10.1", "0.10.2")).toBe("0.10.1");
  expect(notesSeenAtLaunch("0.10.1", "0.10.2", "0.10.2")).toBe("0.10.1");
  expect(notesSeenAtLaunch("0.10.2", "0.10.2", "0.10.2")).toBe("0.10.2");
});
