import { expect, it, vi } from "vite-plus/test";

import { SETTINGS_NAV_GROUPS, SETTINGS_SECTION_LABELS, searchSettings } from "./settingsSearch";

vi.mock("~/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/env")>()),
  isMajordome: true,
  isSecretsFeatureEnabled: false,
}));

it("puts the brain first and folds T3's plumbing under Advanced", () => {
  expect(
    SETTINGS_NAV_GROUPS.map((group) => ({
      heading: group.headingHidden ? null : group.heading,
      collapsible: group.collapsible === true,
      labels: group.paths.map((path) => SETTINGS_SECTION_LABELS[path]),
    })),
  ).toEqual([
    {
      heading: null,
      collapsible: false,
      labels: ["General", "Appearance", "Chat", "Voice"],
    },
    {
      heading: "Your brain",
      collapsible: false,
      labels: ["Overview", "Back up my brain", "Notifications", "Your phone", "Notes folders"],
    },
    { heading: "AI", collapsible: false, labels: ["Providers", "Routines"] },
    {
      heading: "Advanced",
      collapsible: true,
      labels: [
        "Threads",
        "Browser",
        "Diffs",
        "Keybindings",
        "SnapShots",
        "Environments",
        "Sharing & access",
        "Maintenance",
        "Labs",
        "Archive",
      ],
    },
    { heading: null, collapsible: false, labels: ["About"] },
  ]);
});

it("finds the brain's pages, and Advanced pages while they are folded away", () => {
  expect(searchSettings("back up")[0]?.to).toBe("/settings/backup");
  expect(searchSettings("your phone")[0]?.to).toBe("/settings/phone");
  expect(searchSettings("tailscale").map((item) => item.to)).toContain("/settings/phone");
  expect(searchSettings("notifications").map((item) => item.to)).toContain(
    "/settings/notifications",
  );
  expect(searchSettings("overview").map((item) => item.to)).toContain("/settings/overview");
  expect(searchSettings("notes folders").map((item) => item.to)).toContain("/settings/projects");
  expect(searchSettings("keybindings").map((item) => item.to)).toContain("/settings/keybindings");
  expect(searchSettings("archived threads")[0]?.to).toBe("/settings/archived");
});
