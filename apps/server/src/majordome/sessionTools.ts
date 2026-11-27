/**
 * The tools an assistant was started with, as it reported them when its session began. Kept per
 * chat and per AI account, so a chat that has not run since the server started still shows what
 * its account's other chats were given.
 */

import type { ProviderInstanceId, ThreadId } from "@t3tools/contracts";

const byThread = new Map<ThreadId, ReadonlyArray<string>>();
const byInstance = new Map<ProviderInstanceId, ReadonlyArray<string>>();

export function rememberSessionTools(input: {
  readonly threadId: ThreadId;
  readonly instanceId: ProviderInstanceId;
  readonly tools: ReadonlyArray<string>;
}): void {
  if (input.tools.length === 0) return;
  byThread.set(input.threadId, input.tools);
  byInstance.set(input.instanceId, input.tools);
}

export const sessionTools = (
  threadId: ThreadId,
  instanceId: ProviderInstanceId | null | undefined,
): ReadonlyArray<string> | undefined =>
  byThread.get(threadId) ??
  (instanceId === null || instanceId === undefined ? undefined : byInstance.get(instanceId));

const MAJORDOME_TOOL = /^mcp__t3-code__(.+)$/;

/** What each kind of tool is called on the map, in the order shown. Connections have their own box. */
const KINDS: ReadonlyArray<readonly [label: string, matches: (tool: string) => boolean]> = [
  ["Files", (tool) => /^(Read|Write|Edit|MultiEdit|Glob|Grep|NotebookEdit)$/.test(tool)],
  ["Commands", (tool) => tool === "Bash"],
  ["Web search", (tool) => tool === "WebSearch"],
  ["Web pages", (tool) => tool === "WebFetch"],
  ["Browser", (tool) => /^preview_/.test(MAJORDOME_TOOL.exec(tool)?.[1] ?? "")],
  ["Notes search", (tool) => MAJORDOME_TOOL.exec(tool)?.[1] === "search_notes"],
  ["Routines", (tool) => MAJORDOME_TOOL.exec(tool)?.[1] === "schedule_task"],
  ["Notifications", (tool) => MAJORDOME_TOOL.exec(tool)?.[1] === "notify_me"],
  ["Reading list", (tool) => MAJORDOME_TOOL.exec(tool)?.[1] === "add_reading"],
  ["Charts and pages", (tool) => MAJORDOME_TOOL.exec(tool)?.[1] === "html_render"],
  ["Helpers", (tool) => tool === "Agent" || tool === "Task"],
];

/** The kinds of tools among `tools`, in plain words. */
export const plainTools = (tools: ReadonlyArray<string>): ReadonlyArray<string> =>
  KINDS.filter(([, matches]) => tools.some(matches)).map(([label]) => label);
