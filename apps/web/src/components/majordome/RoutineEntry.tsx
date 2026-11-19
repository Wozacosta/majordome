import type { ScheduledTaskRunStatus } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { Entry, Muted, StatusLine } from "./paper";
import { ROUTINE_LAST_RUN } from "./routines.logic";

/** One routine on the Routines screen: what it does, when it runs, and how its last run went. */
export function RoutineEntry({
  title,
  prompt,
  when,
  lastRunStatus,
  lastRunError,
  place,
  controls,
}: {
  readonly title: string;
  /** The routine's instructions; their start says what it does. */
  readonly prompt: string;
  /** When it runs and when it runs next, in plain words. */
  readonly when: string;
  readonly lastRunStatus: ScheduledTaskRunStatus;
  readonly lastRunError: string | null | undefined;
  /** Where its runs arrive, and the way to change that. */
  readonly place?: ReactNode;
  readonly controls: ReactNode;
}) {
  const lastRun = lastRunStatus === "never" ? null : ROUTINE_LAST_RUN[lastRunStatus];
  return (
    <Entry title={title} meta={when} actions={controls} data-routine={title}>
      <Muted className="line-clamp-2 break-words">{prompt}</Muted>
      {lastRun ? (
        <StatusLine tone={lastRun.tone} data-routine-last-run={lastRunStatus}>
          {lastRun.text}
          {lastRunError ? `: ${lastRunError}` : ""}
        </StatusLine>
      ) : lastRunError ? (
        <StatusLine tone="error">{lastRunError}</StatusLine>
      ) : null}
      {place}
    </Entry>
  );
}

/** One upcoming reminder: what it is about, when it comes, and where it will be posted. */
export function ReminderEntry({
  title,
  when,
  conversation,
  controls,
}: {
  readonly title: string;
  /** The date and time it fires and how long until then. */
  readonly when: string;
  /** A link to the conversation it posts in, when it has one. */
  readonly conversation?: ReactNode;
  readonly controls: ReactNode;
}) {
  return (
    <Entry title={title} meta={when} actions={controls} data-reminder={title}>
      {conversation ? <Muted>{conversation}</Muted> : null}
    </Entry>
  );
}
