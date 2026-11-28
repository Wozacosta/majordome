import type { ComputerAiStanding } from "./assistantAi.logic";

/** What Majordome calls the settings pages upstream names for developers. */
export const MAJORDOME_SETTINGS_LABELS = {
  SettingsEnvironments: "Computers",
  SettingsEnvironmentDetail: "Computer",
  SettingsEnvironmentNew: "Add a computer",
  /** The AI row and page while no one AI is in use: none signed in yet, or several. */
  SettingsProviderAccounts: "AI accounts",
  SettingsScheduledTasks: "Routines",
  SettingsSavedKeys: "Passwords and keys",
  SettingsAppearance: "Look and language",
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
  SettingsPhoneNotifications: "Notifications",
} as const;

/** An AI account's sign-in, in place of the sentence its own tool gives. */
export const MAJORDOME_AI_SIGN_IN = {
  signingIn: "Signing in…",
  failed: "That didn't work. Try again.",
  setUp: "Set up",
  signOutEffect: (machine: string) =>
    `Chats answering with this account on ${machine} will stop. Your chats are kept.`,
  /** The field for what the AI's last page shows, in place of "Final localhost URL". */
  pasteBack: "Code or address of the last page",
} as const;

export type SettingsRowTone = "good" | "warning";

/** The page a row opens. A computer's row names which computer. */
export type MajordomeSettingsRowTarget =
  | { readonly page: "SettingsEnvironmentDetail"; readonly environmentId: string }
  | {
      readonly page:
        | "SettingsEnvironments"
        | "SettingsEnvironmentNew"
        | "SettingsProviderAccounts"
        | "SettingsAccount"
        | "SettingsSavedKeys"
        | "SettingsAppearance"
        | "SettingsVoice"
        | "SettingsPhoneNotifications"
        | "SettingsArchive"
        | "SettingsAbout";
    };

export interface MajordomeSettingsRow {
  readonly id: string;
  readonly icon:
    | "desktopcomputer"
    | "plus"
    | "brain"
    | "person.crop.circle"
    | "key"
    | "paintbrush"
    | "mic"
    | "bell.badge"
    | "archivebox"
    | "info.circle";
  readonly label: string;
  readonly value?: string;
  readonly tone?: SettingsRowTone;
  readonly opens: MajordomeSettingsRowTarget;
}

export interface SettingsComputer {
  readonly id: string;
  readonly label: string;
  /** False when the owner switched it off in this app. */
  readonly enabled: boolean;
  /** Upstream's phase: available, offline, connecting, reconnecting, connected, unsupported, error. */
  readonly phase: string;
}

/** Past this many computers the first screen names none: one row leads to the list. */
const COMPUTER_ROWS_MAX = 3;

/** A computer's state in two words, and whether it is the good or the bad kind. */
export function computerStanding(computer: Pick<SettingsComputer, "enabled" | "phase">): {
  readonly value: string;
  readonly tone?: SettingsRowTone;
} {
  if (!computer.enabled) return { value: "Switched off" };
  if (computer.phase === "connected") return { value: "Connected", tone: "good" };
  if (computer.phase === "connecting" || computer.phase === "reconnecting") {
    return { value: "Connecting…" };
  }
  return { value: "Can't be reached", tone: "warning" };
}

/**
 * The AI row across the connected computers. It is named after the AI they answer with, such as
 * "Claude plan", and signed in only when every one is, since a chat on the one that is not would
 * not answer. No state while no computer has said.
 */
export function aiAccountsRow(standings: ReadonlyArray<ComputerAiStanding>): {
  readonly label: string;
  readonly value?: string;
  readonly tone?: SettingsRowTone;
} {
  const names = new Set(
    standings.flatMap((standing) => (standing.state === "ready" ? [standing.name] : [])),
  );
  const [name] = names;
  const label =
    names.size === 1 && name !== undefined
      ? `${name} plan`
      : MAJORDOME_SETTINGS_LABELS.SettingsProviderAccounts;
  const known = standings.filter((standing) => standing.state !== "checking");
  if (known.length === 0) return { label };
  if (known.every((standing) => standing.state === "ready")) {
    return { label, value: "Signed in", tone: "good" };
  }
  return known.some((standing) => standing.state === "signIn")
    ? { label, value: "Sign in", tone: "warning" }
    : { label, value: "Needs a look", tone: "warning" };
}

function computerRows(computers: ReadonlyArray<SettingsComputer>): MajordomeSettingsRow[] {
  if (computers.length === 0) {
    return [
      {
        id: "SettingsEnvironmentNew",
        icon: "plus",
        label: MAJORDOME_SETTINGS_LABELS.SettingsEnvironmentNew,
        opens: { page: "SettingsEnvironmentNew" },
      },
    ];
  }
  if (computers.length > COMPUTER_ROWS_MAX) {
    const connected = computers.filter(
      (computer) => computer.enabled && computer.phase === "connected",
    ).length;
    return [
      {
        id: "SettingsEnvironments",
        icon: "desktopcomputer",
        label: MAJORDOME_SETTINGS_LABELS.SettingsEnvironments,
        value: `${connected} of ${computers.length} connected`,
        ...(connected === computers.length
          ? { tone: "good" as const }
          : connected === 0
            ? { tone: "warning" as const }
            : {}),
        opens: { page: "SettingsEnvironments" },
      },
    ];
  }
  return computers.map((computer) => ({
    id: `computer:${computer.id}`,
    icon: "desktopcomputer",
    label: computer.label,
    ...computerStanding(computer),
    opens: { page: "SettingsEnvironmentDetail", environmentId: computer.id },
  }));
}

/**
 * Settings' first screen as Majordome shows it: four unnamed cards. What the owner depends on
 * (each computer, the AI plan) comes first with its state; then who they are and what the
 * assistant may use; then the app itself, notifications included; then the archive and About.
 * A page upstream adds later is not shown until it is placed here.
 */
export function majordomeSettingsCards(input: {
  readonly computers: ReadonlyArray<SettingsComputer>;
  /** The AI on each connected computer. */
  readonly ai: ReadonlyArray<ComputerAiStanding>;
  /** Null in a build with no account service; `email` null while signed out. */
  readonly account: { readonly email: string | null } | null;
  /** Such as "Dark · English". */
  readonly look: string;
  /** Where speech is turned into text, such as "On this phone". */
  readonly voice: string;
  /** "On" or "Off"; nothing until the phone's copy of the switch is read. */
  readonly notifications?: string;
  readonly version: string;
}): Array<{ readonly rows: ReadonlyArray<MajordomeSettingsRow> }> {
  const cards: Array<ReadonlyArray<MajordomeSettingsRow>> = [
    [
      ...computerRows(input.computers),
      {
        id: "SettingsProviderAccounts",
        icon: "brain",
        ...aiAccountsRow(input.ai),
        opens: { page: "SettingsProviderAccounts" },
      },
    ],
    [
      ...(input.account === null
        ? []
        : [
            {
              id: "SettingsAccount",
              icon: "person.crop.circle",
              label: MAJORDOME_SETTINGS_LABELS.SettingsAccount,
              value: input.account.email ?? "Sign in",
              opens: { page: "SettingsAccount" },
            } satisfies MajordomeSettingsRow,
          ]),
      {
        id: "SettingsSavedKeys",
        icon: "key",
        label: MAJORDOME_SETTINGS_LABELS.SettingsSavedKeys,
        opens: { page: "SettingsSavedKeys" },
      },
    ],
    [
      {
        id: "SettingsAppearance",
        icon: "paintbrush",
        label: MAJORDOME_SETTINGS_LABELS.SettingsAppearance,
        value: input.look,
        opens: { page: "SettingsAppearance" },
      },
      {
        id: "SettingsVoice",
        icon: "mic",
        label: "Voice",
        value: input.voice,
        opens: { page: "SettingsVoice" },
      },
      {
        id: "SettingsPhoneNotifications",
        icon: "bell.badge",
        label: MAJORDOME_SETTINGS_LABELS.SettingsPhoneNotifications,
        ...(input.notifications === undefined ? {} : { value: input.notifications }),
        opens: { page: "SettingsPhoneNotifications" },
      },
    ],
    [
      {
        id: "SettingsArchive",
        icon: "archivebox",
        label: MAJORDOME_SETTINGS_LABELS.SettingsArchive,
        opens: { page: "SettingsArchive" },
      },
      {
        id: "SettingsAbout",
        icon: "info.circle",
        label: "About",
        value: input.version,
        opens: { page: "SettingsAbout" },
      },
    ],
  ];
  return cards.map((rows) => ({ rows }));
}

/** A computer's page: what was "New chat defaults" and "Maintenance", said for that computer. */
export const MAJORDOME_COMPUTER_SETTINGS = {
  /** Above the four levels of how much the assistant does without asking (wording.mts names them). */
  carefulness: "Before changing things",
  quietChats: "Mark quiet chats as done",
  quietDays: "After",
  /** The unit beside the number: "After 7 days". */
  quietDaysUnit: (days: number) => (days === 1 ? "day" : "days"),
} as const;

/** The switches on a computer's page, each one a setting Majordome keeps on that computer. */
export const MAJORDOME_COMPUTER_SWITCHES = [
  { key: "keepAwakeWhileAgentsWork", icon: "bolt.circle", label: "Stay awake while working" },
  {
    key: "continueThreadsAfterServerUpdate",
    icon: "arrow.uturn.forward",
    label: "Carry on after a restart",
  },
  {
    key: "autoResumeLimitedThreads",
    icon: "clock",
    label: "Carry on when the plan's limit resets",
  },
  {
    key: "snoozeLimitedThreads",
    icon: "moon",
    label: "Set chats aside until the limit resets",
  },
  { key: "enableProviderUpdateChecks", icon: "arrow.clockwise", label: "Look for new AI models" },
] as const;
