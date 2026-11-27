import { ClaudeSignInError, type ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isClaudeSignInError = Schema.is(ClaudeSignInError);

/** What a provider still needs before it can answer, as the setup screens tell it. */
export function getOnboardingProviderState(provider: ServerProvider | undefined) {
  if (provider === undefined) return "checking";
  if (!provider.enabled || provider.status === "disabled") return "disabled";
  if (!provider.installed && provider.status === "warning" && provider.auth.status === "unknown")
    return "checking";
  if (!provider.installed) return "install";
  if (provider.auth.status === "unauthenticated") return "signIn";
  if (provider.status === "ready") return "ready";
  return "attention";
}

export interface ClaudeSignInFailure {
  readonly message: string;
  /** Whether the same link and attempt still take a code, so the owner need not start over. */
  readonly attemptOpen: boolean;
}

export function claudeSignInFailure(error: unknown, machine: string): ClaudeSignInFailure {
  if (isClaudeSignInError(error)) {
    return { message: error.message, attemptOpen: error.reason === "codeIncomplete" };
  }
  return {
    message: `Majordome couldn't reach ${machine} to sign in. Check the connection, then start over.`,
    attemptOpen: false,
  };
}
