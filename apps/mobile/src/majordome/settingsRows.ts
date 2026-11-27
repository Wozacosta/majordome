/** What Majordome calls the settings pages upstream names for developers. */
export const MAJORDOME_SETTINGS_LABELS = {
  SettingsEnvironments: "Computers",
  SettingsEnvironmentDetail: "Computer",
  SettingsEnvironmentNew: "Add a computer",
  SettingsProviderAccounts: "AI accounts",
  SettingsScheduledTasks: "Routines",
  SettingsSavedKeys: "Passwords and keys",
  SettingsOrganization: "Language",
  SettingsProjectGrouping: "Language",
  SettingsFollowUp: "Writing messages",
  SettingsThreads: "New chat defaults",
  SettingsEnvironmentNewThreads: "New chat defaults",
  SettingsEnvironmentAgentBehavior: "New chat defaults",
  SettingsArchive: "Archived chats",
  SettingsHostedSignup: "A Majordome server",
  SettingsUseComputer: "Use your computer",
  SettingsAccount: "Your account",
} as const;

type Labelled = keyof typeof MAJORDOME_SETTINGS_LABELS;

/**
 * Settings as Majordome lists them, grouped by what the owner is setting up. Any page left out
 * (projects, source control, worktrees, labs, tab order, T3's account) is not shown, and
 * neither is a page upstream adds later until it is placed here.
 */
const LAYOUT: ReadonlyArray<{ readonly title?: string; readonly pages: readonly string[] }> = [
  { pages: ["SettingsAccount", "SettingsEnvironments"] },
  {
    title: "The assistant",
    pages: ["SettingsProviderAccounts", "SettingsScheduledTasks", "SettingsSavedKeys"],
  },
  {
    title: "This app",
    pages: ["SettingsOrganization", "SettingsAppearance", "SettingsFollowUp", "SettingsVoice"],
  },
  {
    title: "Advanced",
    pages: ["SettingsThreads", "SettingsKeyboard", "SettingsEnvironmentMaintenance"],
  },
  { pages: ["SettingsAbout", "SettingsArchive"] },
];

interface Row {
  readonly id: string;
  readonly label: string;
}

/** Upstream's settings rows, kept, renamed and regrouped the way Majordome shows them. */
export function majordomeSettingsSections<R extends Row>(
  sections: ReadonlyArray<{ readonly rows: readonly R[] }>,
): Array<{ readonly title?: string; readonly rows: R[] }> {
  const byId = new Map(sections.flatMap((section) => section.rows).map((row) => [row.id, row]));
  return LAYOUT.flatMap(({ title, pages }) => {
    const rows = pages.flatMap((id) => {
      const row = byId.get(id);
      if (row === undefined) return [];
      const label =
        id in MAJORDOME_SETTINGS_LABELS ? MAJORDOME_SETTINGS_LABELS[id as Labelled] : null;
      return [label === null ? row : { ...row, label }];
    });
    if (rows.length === 0) return [];
    return [title === undefined ? { rows } : { title, rows }];
  });
}
