/** This build is Majordome, upstream's phone app with its coding screens put away. */
export const isMajordome: boolean = true;

/** A chat shows the answers and leaves the work out, as on the computer, until Settings says otherwise. */
export const DEFAULT_TOOL_CALL_VISIBILITY = isMajordome ? "zen" : "showAll";

/** Upstream's coding tabs, which Majordome never shows. */
export const MAJORDOME_HIDDEN_TABS = isMajordome ? (["pullRequests", "issues"] as const) : [];
