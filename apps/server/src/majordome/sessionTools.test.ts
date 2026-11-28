import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { MAJORDOME_TOOLS, plainTools, rememberSessionTools, sessionTools } from "./sessionTools.ts";

it("names the kinds of tools a session reported, and leaves connections to their own box", () => {
  expect(
    plainTools([
      "Agent",
      "Bash",
      "Read",
      "Edit",
      "WebSearch",
      "mcp__t3-code__preview_open",
      "mcp__t3-code__preview_act",
      "mcp__t3-code__schedule_task",
      "mcp__claude_ai_Gmail__search_threads",
      "SomethingNew",
    ]),
  ).toEqual(["Files", "Commands", "Web search", "Browser", "Routines", "Helpers"]);
  expect(plainTools([])).toEqual([]);
});

it("answers for a chat that has not run with what its AI account's other chats were given", () => {
  const instanceId = ProviderInstanceId.make("claude-main");
  rememberSessionTools({ threadId: ThreadId.make("ran"), instanceId, tools: ["Bash"] });
  expect(sessionTools(ThreadId.make("ran"), instanceId)).toEqual(["Bash"]);
  expect(sessionTools(ThreadId.make("idle"), instanceId)).toEqual(["Bash"]);
  expect(sessionTools(ThreadId.make("idle"), ProviderInstanceId.make("other"))).toBeUndefined();
  expect(sessionTools(ThreadId.make("idle"), null)).toBeUndefined();
});

it("names what Majordome gives an AI that does not report its tools", () => {
  expect(plainTools(MAJORDOME_TOOLS)).toEqual([
    "Browser",
    "Notes search",
    "Routines",
    "Notifications",
    "Reading list",
    "Charts and pages",
  ]);
});
