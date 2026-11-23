import { describe, expect, it } from "vite-plus/test";

import { majordomeSettingsSections } from "./settingsRows";

const row = (id: string, label: string) => ({ id, label, icon: "gearshape" });

const upstream = [
  {
    title: "Connections",
    rows: [row("account", "T3 Account"), row("SettingsEnvironments", "Environments")],
  },
  {
    rows: [
      row("SettingsOrganization", "General"),
      row("SettingsAppearance", "Appearance"),
      row("SettingsFollowUp", "Chat"),
      row("SettingsNavigation", "Navigation tabs"),
      row("SettingsKeyboard", "Keyboard"),
      row("SettingsVoice", "Voice"),
    ],
  },
  {
    title: "Agents",
    rows: [
      row("SettingsProviderAccounts", "Providers"),
      row("SettingsThreads", "Threads"),
      row("SettingsScheduledTasks", "Scheduled tasks"),
    ],
  },
  {
    title: "Code",
    rows: [
      row("SettingsProjectOverview", "Projects"),
      row("SettingsEnvironmentSourceControl", "Source control & issues"),
      row("SettingsWorktrees", "Worktrees"),
    ],
  },
  {
    rows: [
      row("SettingsEnvironmentMaintenance", "Maintenance"),
      row("SettingsLabs", "Labs"),
      row("SettingsAbout", "About"),
      row("SettingsArchive", "Archive"),
      row("SettingsSomethingNew", "Something upstream added"),
    ],
  },
];

describe("majordomeSettingsSections", () => {
  it("keeps the owner's pages, under Majordome's names and groups", () => {
    expect(
      majordomeSettingsSections(upstream).map((section) => [
        section.title ?? null,
        section.rows.map((entry) => entry.label),
      ]),
    ).toEqual([
      [null, ["Computers"]],
      ["The assistant", ["AI accounts", "Routines"]],
      ["This app", ["Language", "Appearance", "Writing messages", "Voice"]],
      ["Advanced", ["New chat defaults", "Keyboard", "Maintenance"]],
      [null, ["About", "Archived chats"]],
    ]);
  });

  it("keeps everything else a row carries, and drops a group left empty", () => {
    const disabled = { ...row("SettingsThreads", "Threads"), disabled: true };
    expect(majordomeSettingsSections([{ rows: [disabled] }])).toEqual([
      { title: "Advanced", rows: [{ ...disabled, label: "New chat defaults" }] },
    ]);
  });
});
