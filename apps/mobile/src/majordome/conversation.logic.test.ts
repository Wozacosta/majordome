import { expect, it } from "vite-plus/test";

import {
  activityInPlainWords,
  approvalChoices,
  approvalQuestion,
  composerPlaceholder,
  connectionProblemInPlainWords,
  conversationMenu,
  failureInPlainWords,
  noteName,
} from "./conversation.logic";

it.each([
  ["Notes/Taxes 2026.md", "Taxes 2026"],
  ["/Users/me/Brain/People/Anna.markdown", "Anna"],
  ["C:\\Notes\\list.MD", "list"],
  ["receipts/march.pdf", "march.pdf"],
  ["Projects/", "Projects"],
  ["", ""],
])("names %j the way a person would: %j", (path, name) => {
  expect(noteName(path)).toBe(name);
});

it.each([
  [{ kind: "read", state: "working", paths: ["Notes/Taxes.md"] }, "Reading Taxes"],
  [{ kind: "read", state: "done", paths: [] }, "Read a note"],
  [{ kind: "read", state: "done", paths: ["a.md", "b.md", "c.md"] }, "Read a and 2 more"],
  [{ kind: "read", state: "failed", paths: ["Anna.md"] }, "Couldn't read Anna"],
  [{ kind: "edit", state: "working" }, "Writing a note"],
  [{ kind: "edit", state: "done", paths: ["People/Anna.md"] }, "Updated Anna"],
  [{ kind: "code-search", state: "working" }, "Searching your notes"],
  [{ kind: "code-search", state: "failed" }, "Couldn't search your notes"],
  [{ kind: "search", state: "working" }, "Looking on the web"],
  [{ kind: "search", state: "done" }, "Looked on the web"],
  [{ kind: "browser", state: "done" }, "Opened a web page"],
  [{ kind: "thread-create", state: "done" }, "Started another chat"],
  [{ kind: "command", state: "working" }, "Working…"],
  [{ kind: "command", state: "done" }, "Finished a step"],
  [{ kind: "other", state: "failed" }, "A step didn't work"],
  [{ kind: "a-kind-added-upstream", state: "working" }, "Working…"],
  [
    { kind: "other", state: "done", itemType: "reasoning", fallback: "Checking the tax note" },
    "Checking the tax note",
  ],
  [{ kind: "other", state: "done", sentence: "Created a routine" }, "Created a routine"],
  [{ kind: "other", state: "working", service: "Gmail" }, "Using Gmail"],
  [{ kind: "other", state: "done", service: "Gmail" }, "Used Gmail"],
  [{ kind: "other", state: "failed", service: "Gmail" }, "Couldn't use Gmail"],
  [{ kind: "update", state: "done", fallback: "Context compacted" }, "Context compacted"],
  [{ kind: "update", state: "done" }, "Finished a step"],
  [
    { kind: "other", state: "done", itemType: "approval_request", fallback: "Approval requested" },
    "Approval requested",
  ],
  [
    { kind: "command", state: "done", itemType: "command_execution", fallback: "ls -la" },
    "Finished a step",
  ],
] as const)("says step %j as %j", (step, words) => {
  expect(activityInPlainWords(step)).toBe(words);
});

it.each([
  [
    { kind: "file-change", detail: "Edit /Users/me/Brain/People/Anna.md" },
    "Majordome wants to change Anna. Allow?",
  ],
  [
    { kind: "file-change", detail: "Claude wants to edit /Users/me/Brain/Taxes 2026.md" },
    "Majordome wants to change Taxes 2026. Allow?",
  ],
  [
    { kind: "file-change", detail: "Write People/Anna.md" },
    "Majordome wants to change Anna. Allow?",
  ],
  [{ kind: "file-change" }, "Majordome wants to change a note. Allow?"],
  [
    { kind: "file-read", detail: 'Read "receipts/march.pdf"' },
    "Majordome wants to read march.pdf. Allow?",
  ],
  [{ kind: "file-read", detail: "the whole folder" }, "Majordome wants to read a file. Allow?"],
  [
    { kind: "command", detail: "rm -rf build/out.log" },
    "Majordome wants to run a command on your computer. Allow?",
  ],
  [{ kind: "permission", appName: "Gmail" }, "Majordome wants to use Gmail. Allow?"],
  [{ kind: "mcp-elicitation" }, "Majordome needs your OK to go on. Allow?"],
] as const)("asks about %j as %j", (approval, question) => {
  expect(approvalQuestion(approval)).toBe(question);
});

it("always offers a way to refuse, and keeps the AI account's own choices", () => {
  expect(approvalChoices(undefined, "decline")).toEqual([
    { decision: "accept", label: "Allow" },
    { decision: "acceptForSession", label: "Allow for the rest of this chat" },
    { decision: "decline", label: "Don't allow" },
  ]);
  const offered = [
    { decision: "accept", label: "Yes" },
    { decision: "decline", label: "No, keep it" },
  ];
  expect(approvalChoices(offered, "decline")).toBe(offered);
  expect(approvalChoices([{ decision: "accept", label: "Yes" }], "decline")).toEqual([
    { decision: "accept", label: "Yes" },
    { decision: "decline", label: "Don't allow" },
  ]);
  const stops = [
    { decision: "acceptAlways", label: "Always" },
    { decision: "cancel", label: "Cancel" },
  ];
  expect(approvalChoices(stops, "decline")).toBe(stops);
});

it.each([
  ["provider_error", "overloaded", "The AI ran into a problem. Send your message again."],
  ["transport_error", "socket closed", "The link to the AI dropped. Send your message again."],
  [
    "provider_error",
    "Invalid API key · Please run /login",
    "Your AI account isn't signed in. Sign in on your computer, in Settings under AI accounts.",
  ],
  [
    "permission_error",
    "401 Unauthorized",
    "Your AI account isn't signed in. Sign in on your computer, in Settings under AI accounts.",
  ],
  [
    "permission_error",
    "organization disabled",
    "The AI account refused this. Check on your computer that it is signed in.",
  ],
  [
    "usage_limit",
    "limit reached, sign in to another account",
    "Your AI account has reached its limit. Try again later.",
  ],
  ["unknown", "boom", "Something went wrong. Send your message again."],
  ["a-class-added-upstream", "boom", "Something went wrong. Send your message again."],
] as const)("explains a %s failure saying %j", (failureClass, message, words) => {
  expect(failureInPlainWords({ class: failureClass, message })).toBe(words);
});

it.each([
  ["offline", "Mac mini", "You're offline. Tap to retry."],
  ["error", "Mac mini", "Can't reach Mac mini. Tap to retry."],
  ["error", " ", "Can't reach your computer. Tap to retry."],
  ["available", null, "Not connected. Tap to connect."],
  ["unsupported", "Mac mini", "Update this app to connect."],
] as const)("explains a connection that is %s to %j", (problem, computer, words) => {
  expect(connectionProblemInPlainWords(problem, computer)).toBe(words);
});

it("invites what the chat is waiting for", () => {
  expect(composerPlaceholder({ waitsForApproval: false, working: false })).toBe(
    "Ask Majordome anything",
  );
  expect(composerPlaceholder({ waitsForApproval: false, working: true })).toBe(
    "Add something while Majordome works",
  );
  expect(composerPlaceholder({ waitsForApproval: true, working: true })).toBe(
    "Or say what to do instead",
  );
});

it("offers the way back on a chat marked as done, and never both ways at once", () => {
  const ids = (done: boolean, canMarkDone: boolean) =>
    conversationMenu({ done, canMarkDone }).map((entry) => entry.id);
  expect(ids(false, true)).toEqual(["rename", "mark-done", "delete"]);
  expect(ids(true, true)).toEqual(["rename", "bring-back", "delete"]);
  expect(ids(false, false)).toEqual(["rename", "delete"]);
  expect(conversationMenu({ done: false, canMarkDone: true }).at(-1)?.destructive).toBe(true);
});
