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

// Accounts show only in a build with an account service, which a developer's `.env` may name.
vi.mock("../../cloud/publicConfig", () => ({ hasAccountPublicConfig: () => false }));

it("shows six parts, each folded, four of them with a page that explains the part", () => {
  expect(
    SETTINGS_NAV_GROUPS.map((group) => ({
      heading: group.heading,
      collapsible: group.collapsible === true,
      guide: group.guide ?? null,
      labels: group.paths.map((path) => SETTINGS_SECTION_LABELS[path]),
    })),
  ).toEqual([
    {
      heading: "This app",
      collapsible: true,
      guide: "app",
      labels: [
        "General",
        "Appearance",
        "Writing messages",
        "Voice",
        "Browser",
        "Keyboard shortcuts",
      ],
    },
    {
      heading: "Notes",
      collapsible: true,
      guide: "notes",
      labels: ["Notes folders", "Back up my brain"],
    },
    {
      heading: "Files & credentials",
      collapsible: true,
      guide: null,
      labels: ["Private documents"],
    },
    {
      heading: "AI",
      collapsible: true,
      guide: "ai",
      labels: ["AI accounts", "Connections", "Skills"],
    },
    {
      heading: "You and your devices",
      collapsible: true,
      guide: "devices",
      labels: ["Phone & notifications", "Your servers"],
    },
    {
      heading: "Others",
      collapsible: true,
      guide: null,
      labels: [
        "Status",
        "New chat defaults",
        "Computers",
        "Sharing & access",
        "Maintenance",
        "Labs",
        "About",
        "Archived chats",
      ],
    },
  ]);
});

it("finds the brain's pages, and Advanced pages while they are folded away", () => {
  expect(searchSettings("back up")[0]?.to).toBe("/settings/backup");
  expect(searchSettings("your phone")[0]?.to).toBe("/settings/phone");
  expect(searchSettings("gmail")[0]?.to).toBe("/settings/connectors");
  expect(searchSettings("tailscale").map((item) => item.to)).toContain("/settings/phone");
  expect(searchSettings("always-on server")[0]?.to).toBe("/settings/always-on");
  expect(searchSettings("notifications")[0]?.to).toBe("/settings/phone");
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

it("finds a page by the everyday word for it", () => {
  const first = (query: string) => searchSettings(query)[0];
  // "Microphone" and "Thread notifications" match as well; the page named by the word leads.
  expect(first("phone")?.to).toBe("/settings/phone");
  expect(searchSettings("phone").filter((item) => item.to === "/settings/phone")).toHaveLength(1);
  expect(first("push alerts")?.to).toBe("/settings/phone");
  expect(first("text size")?.id).toBe("interface-font");
  for (const query of ["sleep", "laptop", "closed", "awake"]) {
    expect(
      searchSettings(query).map((item) => item.to),
      query,
    ).toContain("/settings/always-on");
  }
  for (const query of ["email", "calendar"]) {
    expect(first(query)?.to, query).toBe("/settings/connectors");
  }
});

it("says Done for the shelf, and still finds it for people who search T3's word", () => {
  const titles = (query: string) => searchSettings(query).map((item) => item.title);
  expect(titles("move chats to earlier")).toContain("Move inactive chats to Done");
  expect(titles("auto-settle")).toEqual(
    expect.arrayContaining(["Move inactive chats to Done", "Days before chats move to Done"]),
  );
  expect(titles("settle")).toContain("Chat: Mark as done");
  expect(titles("settle").some((title) => /settle/i.test(title))).toBe(false);
});
