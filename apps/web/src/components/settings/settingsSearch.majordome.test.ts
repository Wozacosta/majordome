import { expect, it, vi } from "vite-plus/test";

import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_SECTION_LABELS,
  SETTINGS_SEARCH_ITEMS,
  searchSettings,
  settingsForThisPlatform,
} from "./settingsSearch";

vi.mock("~/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/env")>()),
  isMajordome: true,
  isSecretsFeatureEnabled: false,
}));

it("opens on Status, groups pages by what is being set up, and folds T3's plumbing away", () => {
  expect(
    SETTINGS_NAV_GROUPS.map((group) => ({
      heading: group.headingHidden ? null : group.heading,
      collapsible: group.collapsible === true,
      labels: group.paths.map((path) => SETTINGS_SECTION_LABELS[path]),
    })),
  ).toEqual([
    { heading: null, collapsible: false, labels: ["Status"] },
    {
      heading: "Your notes",
      collapsible: false,
      labels: ["Notes folders", "Back up my brain", "Private documents"],
    },
    { heading: "The assistant", collapsible: false, labels: ["AI accounts", "Connections"] },
    {
      heading: "Your devices",
      collapsible: false,
      labels: ["Your phone", "Notifications", "Always-on server"],
    },
    {
      heading: "This app",
      collapsible: false,
      labels: ["General", "Appearance", "Writing messages", "Voice"],
    },
    {
      heading: "Advanced",
      collapsible: true,
      labels: [
        "New chat defaults",
        "Computers",
        "Sharing & access",
        "Browser",
        "Keyboard shortcuts",
        "Maintenance",
        "Labs",
      ],
    },
    { heading: null, collapsible: false, labels: ["About", "Archived chats"] },
  ]);
});

it("finds the brain's pages, and Advanced pages while they are folded away", () => {
  expect(searchSettings("back up")[0]?.to).toBe("/settings/backup");
  expect(searchSettings("your phone")[0]?.to).toBe("/settings/phone");
  expect(searchSettings("gmail")[0]?.to).toBe("/settings/connectors");
  expect(searchSettings("tailscale").map((item) => item.to)).toContain("/settings/phone");
  expect(searchSettings("always-on server")[0]?.to).toBe("/settings/always-on");
  expect(searchSettings("notifications").map((item) => item.to)).toContain(
    "/settings/notifications",
  );
  expect(searchSettings("overview").map((item) => item.to)).toContain("/settings/overview");
  expect(searchSettings("notes folders").map((item) => item.to)).toContain("/settings/projects");
  expect(searchSettings("keybindings").map((item) => item.to)).toContain("/settings/keybindings");
  expect(searchSettings("archived threads")[0]?.to).toBe("/settings/archived");
  expect(searchSettings("scheduled tasks").map((item) => item.to)).not.toContain(
    "/settings/scheduled-tasks",
  );
  const shown = settingsForThisPlatform(SETTINGS_SEARCH_ITEMS);
  const pages = shown.map((item) => item.to);
  expect(pages).not.toContain("/settings/diffs");
  expect(pages).not.toContain("/settings/snap-shot");
  const ids = shown.map((item) => item.id);
  for (const id of [
    "project-grouping",
    "terminal-close-confirmation",
    "new-threads",
    "keep-threads-with-pull-requests",
    "git-fetch-interval",
    "boring-sidebar-multiline",
    "preview-tunnel",
    "mobile-app",
  ]) {
    expect(ids, id).not.toContain(id);
  }
  expect(ids).toEqual(expect.arrayContaining(["default-model", "auto-settle-inactive-threads"]));
});

it("says Earlier for the shelf, and still finds it for people who search T3's word", () => {
  const titles = (query: string) => searchSettings(query).map((item) => item.title);
  expect(titles("move chats to earlier")).toContain("Move inactive chats to Earlier");
  expect(titles("auto-settle")).toEqual(
    expect.arrayContaining(["Move inactive chats to Earlier", "Days before chats move to Earlier"]),
  );
  expect(titles("settle")).toContain("Chat: Mark as done");
  expect(titles("settle").some((title) => /settle/i.test(title))).toBe(false);
});
