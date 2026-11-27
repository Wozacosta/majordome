import type { getOnboardingProviderState } from "@t3tools/shared/claudeSignIn";

export interface ClaudeSetupRow {
  /** `signIn` is the one state the phone can settle by itself. */
  readonly kind: "checking" | "ready" | "signIn" | "elsewhere";
  readonly text: string;
}

/** Claude's line on the phone's setup: where it stands and whether the phone can sign it in. */
export function claudeSetupRow(
  state: ReturnType<typeof getOnboardingProviderState>,
  allowed: boolean,
  machine: string,
): ClaudeSetupRow {
  switch (state) {
    case "checking":
      return { kind: "checking", text: "Checking…" };
    case "ready":
      return { kind: "ready", text: "Signed in" };
    case "signIn":
      return allowed
        ? { kind: "signIn", text: "Not signed in yet" }
        : { kind: "elsewhere", text: `This phone isn't allowed to sign in. Do it on ${machine}.` };
    case "install":
      return { kind: "elsewhere", text: `Not installed yet. Install it on ${machine}.` };
    case "disabled":
      return { kind: "elsewhere", text: `Turned off in Settings on ${machine}.` };
    case "attention":
      return { kind: "elsewhere", text: `Needs a look on ${machine}.` };
  }
}
