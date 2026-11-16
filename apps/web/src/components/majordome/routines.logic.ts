import type { ScheduledTaskRunStatus } from "@t3tools/contracts";

/** How a routine's last run went, in the owner's words. */
export const ROUTINE_LAST_RUN: Record<
  Exclude<ScheduledTaskRunStatus, "never">,
  { readonly tone: "ok" | "neutral" | "error"; readonly text: string }
> = {
  succeeded: { tone: "ok", text: "Last run went well" },
  failed: { tone: "error", text: "Last run couldn't finish" },
  running: { tone: "neutral", text: "Running now" },
};
