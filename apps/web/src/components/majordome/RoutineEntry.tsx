import type { ScheduledTaskRunStatus } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { Entry, Muted, StatusLine } from "./paper";

/** The Routines screen sits in Settings, whose rows are inset this much. */
export const ROUTINES_INSET_CLASS = "px-3 sm:px-4";

const LAST_RUN: Record<
  Exclude<ScheduledTaskRunStatus, "never">,
  { readonly tone: "ok" | "neutral" | "error"; readonly text: string }
> = {
  succeeded: { tone: "ok", text: "Last run went well" },
  failed: { tone: "error", text: "Last run couldn't finish" },
  running: { tone: "neutral", text: "Running now" },
};

/** One routine on the Routines screen: what it is, when it runs, and how its last run went. */
export function RoutineEntry({
  title,
  prompt,
  schedule,
  lastRunStatus,
  lastRunError,
  threadLink,
  controls,
}: {
  readonly title: string;
  readonly prompt: string;
  /** When it runs and when it runs next, in plain words. */
  readonly schedule: ReactNode;
  readonly lastRunStatus: ScheduledTaskRunStatus;
  readonly lastRunError: string | null | undefined;
  readonly threadLink?: ReactNode;
  readonly controls: ReactNode;
}) {
  const lastRun = lastRunStatus === "never" ? null : LAST_RUN[lastRunStatus];
  return (
    <Entry
      as="div"
      className={ROUTINES_INSET_CLASS}
      title={title}
      meta={schedule}
      actions={controls}
    >
      <Muted className="line-clamp-2 break-words">{prompt}</Muted>
      {lastRun ? (
        <StatusLine tone={lastRun.tone} data-routine-last-run={lastRunStatus}>
          {lastRun.text}
          {lastRunError ? `: ${lastRunError}` : ""}
        </StatusLine>
      ) : lastRunError ? (
        <StatusLine tone="error">{lastRunError}</StatusLine>
      ) : null}
      {threadLink ? <p className="text-xs text-muted-foreground">{threadLink}</p> : null}
    </Entry>
  );
}
