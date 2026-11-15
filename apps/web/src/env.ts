// Preload installs desktopBridge before web code runs, so module-load detection is reliable.
export const isElectron = typeof window !== "undefined" && window.desktopBridge !== undefined;

/** Majordome is a second brain, not a coding tool: T3 Code's git, terminal and pull request UI stays hidden. */
export const isMajordome: boolean = true;

export const isSecretsFeatureEnabled = ["1", "true"].includes(
  import.meta.env.T3CODE_FEATURE_SECRETS?.trim().toLowerCase() ?? "",
);
