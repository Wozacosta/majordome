/** This build is Majordome, upstream's phone app with its coding screens put away. */
export const isMajordome: boolean = true;

/** Upstream's coding tabs, which Majordome never shows. */
export const MAJORDOME_HIDDEN_TABS = isMajordome ? (["pullRequests", "issues"] as const) : [];
