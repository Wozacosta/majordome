import { describe, expect, it } from "vite-plus/test";

import {
  classifySignInOutput,
  claudeSignInEnvironment,
  extractSignInUrl,
  isCompleteSignInCode,
} from "./claudeSignInOutput.ts";

const SIGN_IN_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference&code_challenge=abc_DEF-123&code_challenge_method=S256&state=xyz_STATE-456";

const hyperlink = (target: string, text: string) =>
  `\u001b]8;;${target}\u0007${text}\u001b]8;;\u0007`;

describe("extractSignInUrl", () => {
  it.each([
    [
      "the hyperlink target, though the visible text is wrapped",
      `Opening browser to sign in…\r\nIf the browser didn't open, visit: ${hyperlink(
        SIGN_IN_URL,
        `${SIGN_IN_URL.slice(0, 80)}\r\n${SIGN_IN_URL.slice(80, 160)}\r\n${SIGN_IN_URL.slice(160)}`,
      )}\r\nPaste code here if prompted > `,
    ],
    [
      "a hyperlink closed by the string terminator, between colour codes",
      `\u001b[2mIf the browser didn't open, visit: \u001b[0m\u001b]8;id=1;${SIGN_IN_URL}\u001b\\link\u001b]8;;\u001b\\\r\n`,
    ],
    [
      "plain wrapped text with no hyperlink, once the prompt follows it",
      `Sign in at: ${SIGN_IN_URL.slice(0, 100)}\r\n${SIGN_IN_URL.slice(100, 200)}\n${SIGN_IN_URL.slice(200)}\r\nPaste code here > `,
    ],
  ])("reads %s", (_name, output) => {
    expect(extractSignInUrl(output)).toBe(SIGN_IN_URL);
  });

  it.each([
    ["nothing printed yet", "Opening browser to sign in…\r\n"],
    [
      "a hyperlink still being written",
      `If the browser didn't open, visit: \u001b]8;;${SIGN_IN_URL.slice(0, 120)}`,
    ],
    ["plain text with no prompt after it yet", `Sign in at: ${SIGN_IN_URL.slice(0, 100)}\r\n`],
    [
      "a link that is not the sign-in page",
      `${hyperlink("https://code.claude.com/docs/en/overview", "docs")}\r\nPaste code here > `,
    ],
    [
      "a sign-in page that is not https",
      "visit: http://claude.com/cai/oauth/authorize?code=true\r\nPaste code here > ",
    ],
  ])("waits on %s", (_name, output) => {
    expect(extractSignInUrl(output)).toBeUndefined();
  });
});

describe("classifySignInOutput", () => {
  it.each([
    ["\r\nLogin successful.\r\n", "signedIn"],
    ["\u001b[32mLogin successful.\u001b[0m\r\n", "signedIn"],
    [
      "\r\nLogin failed: That code wasn't accepted. It may be incomplete, expired, already used, or from an earlier sign-in attempt. Sign in again to get a new code.\r\n",
      "codeRejected",
    ],
    ["Invalid code. Please make sure the full code was copied.\r\n", "codeIncomplete"],
    [
      "That code is not from this sign-in. Paste the code shown after opening the address above.\r\n",
      "codeIncomplete",
    ],
    ["Login failed: Token exchange failed\r\n", "failed"],
    ["abc#def\r\n", undefined],
    ["", undefined],
  ] as const)("reads %j as %s", (output, outcome) => {
    expect(classifySignInOutput(output)).toBe(outcome);
  });
});

it.each([
  ["abc123#state456", true],
  ["abc123", false],
  ["abc123#", false],
  ["#state456", false],
  ["abc 123#state456", false],
  ["abc#def#ghi", false],
])("accepts only a whole code: %j", (code, complete) => {
  expect(isCompleteSignInCode(code)).toBe(complete);
});

it("runs the sign-in without any other credential and without opening a browser", () => {
  const environment = claudeSignInEnvironment({
    PATH: "/usr/bin",
    CLAUDE_CONFIG_DIR: "/data/.claude",
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-token",
    CLAUDE_CODE_OAUTH_REFRESH_TOKEN: "refresh",
    CLAUDE_CODE_OAUTH_SCOPES: "user:inference",
    ANTHROPIC_API_KEY: "sk-ant-api03-key",
    anthropic_auth_token: "proxy-token",
    BROWSER: "firefox",
  });
  expect(environment).toEqual({
    PATH: "/usr/bin",
    CLAUDE_CONFIG_DIR: "/data/.claude",
    BROWSER: "true",
  });
});
