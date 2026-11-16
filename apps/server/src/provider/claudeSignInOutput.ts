/**
 * Reads what `claude auth login` prints under a terminal, and names the variables that keep
 * Claude Code from using a stored claude.ai login.
 */

export const CLAUDE_SIGN_IN_TOKEN_VARIABLE = "CLAUDE_CODE_OAUTH_TOKEN";

// Each of these outranks the stored login, or makes `auth login` skip its interactive flow.
const CLAUDE_CREDENTIAL_VARIABLES = new Set([
  CLAUDE_SIGN_IN_TOKEN_VARIABLE,
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_SCOPES",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
]);

/** The environment for `claude auth login`: no other credential, and no browser on the server. */
export function claudeSignInEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...environment };
  for (const name of Object.keys(next)) {
    // Windows reads names without regard to case.
    if (CLAUDE_CREDENTIAL_VARIABLES.has(name.toUpperCase())) delete next[name];
  }
  // Claude Code runs $BROWSER with the link instead of the system opener; `true` opens nothing.
  next.BROWSER = "true";
  return next;
}

const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OTHER_ESCAPE = /\u001b[@-Z\\-_]/g;

function stripTerminalSequences(output: string): string {
  return output.replace(OSC_SEQUENCE, "").replace(CSI_SEQUENCE, "").replace(OTHER_ESCAPE, "");
}

// The link is printed as an OSC 8 hyperlink, whose target a terminal never wraps.
const HYPERLINK_TARGET = /\u001b\]8;[^;\u0007\u001b]*;([^\u0007\u001b]+)(?:\u0007|\u001b\\)/g;
const CODE_PROMPT = /Paste code here/;

function isSignInUrl(candidate: string): boolean {
  const url = URL.parse(candidate);
  return url !== null && url.protocol === "https:" && url.pathname.includes("/oauth/");
}

/**
 * The authorize link, once Claude has printed all of it. The printed text can reach us split
 * over lines, so it only counts once the code prompt that follows it is there.
 */
export function extractSignInUrl(output: string): string | undefined {
  for (const match of output.matchAll(HYPERLINK_TARGET)) {
    const target = match[1]?.trim();
    if (target !== undefined && isSignInUrl(target)) return target;
  }
  const text = stripTerminalSequences(output);
  const promptAt = text.search(CODE_PROMPT);
  if (promptAt < 0) return undefined;
  const printed = text.slice(0, promptAt);
  const start = printed.indexOf("https://");
  if (start < 0) return undefined;
  const candidate = printed.slice(start).replace(/\s+/g, "");
  return isSignInUrl(candidate) ? candidate : undefined;
}

/** Claude's code is `<code>#<state>`; it answers anything else with "Invalid code". */
export function isCompleteSignInCode(code: string): boolean {
  const [authorizationCode, state, ...rest] = code.split("#");
  return Boolean(authorizationCode) && Boolean(state) && rest.length === 0 && !/\s/.test(code);
}

export type ClaudeSignInOutcome = "signedIn" | "codeIncomplete" | "codeRejected" | "failed";

/** What Claude said about a pasted code, or undefined while it has not answered. */
export function classifySignInOutput(output: string): ClaudeSignInOutcome | undefined {
  const text = stripTerminalSequences(output);
  if (/Login successful/i.test(text)) return "signedIn";
  if (/code wasn.t accepted/i.test(text)) return "codeRejected";
  if (/Invalid code|code is not from this sign-in/i.test(text)) return "codeIncomplete";
  if (/Login failed|Login interrupted/i.test(text)) return "failed";
  return undefined;
}
