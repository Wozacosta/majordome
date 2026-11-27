import { ClaudeSignInError, ProviderInstanceId } from "@t3tools/contracts";
import { claudeSignInFailure } from "@t3tools/shared/claudeSignIn";
import { expect, it } from "vite-plus/test";

import { claudeSignInNotes } from "./ClaudeSignInSection.logic";

const instanceId = ProviderInstanceId.make("claudeAgent");

it.each([
  ["codeIncomplete", true],
  ["codeRejected", false],
  ["expired", false],
  ["noAttempt", false],
] as const)("after %s the same attempt stays open: %s", (reason, attemptOpen) => {
  const error = new ClaudeSignInError({ instanceId, reason });
  expect(claudeSignInFailure(error, "Home server")).toEqual({
    message: error.message,
    attemptOpen,
  });
});

it("names the machine when the request itself did not get through", () => {
  expect(claudeSignInFailure(new Error("socket closed"), "Home server")).toEqual({
    message:
      "Majordome couldn't reach Home server to sign in. Check the connection, then start over.",
    attemptOpen: false,
  });
});

it.each([
  [{ savedToken: "none", serverToken: "none" }, []],
  [{ savedToken: "removed", serverToken: "none" }, ["ok"]],
  [{ savedToken: "removed", serverToken: "ignored" }, ["ok", "ok"]],
  [{ savedToken: "stillSet", serverToken: "none" }, ["warning"]],
  [{ savedToken: "none", serverToken: "stillSet" }, ["warning"]],
] as const)("says what became of a sign-in token: %j", (result, tones) => {
  expect(claudeSignInNotes(result).map((note) => note.tone)).toEqual(tones);
});

it("tells the owner exactly what to remove from a server whose own token still wins", () => {
  expect(claudeSignInNotes({ savedToken: "none", serverToken: "stillSet" })[0]?.text).toContain(
    "Remove the CLAUDE_CODE_OAUTH_TOKEN line from the server's .env file, then restart the server.",
  );
});
