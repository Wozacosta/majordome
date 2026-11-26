import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import { Disclosure, Entry, Muted, StatusLine } from "./paper";
import type { RoutineLastRun } from "./routines.logic";

/** One routine on the Routines screen: what it does, when it runs, and how its last run went. */
export function RoutineEntry({
  title,
  prompt,
  when,
  lastRun,
  lastRunRemedy,
  place,
  controls,
  id,
}: {
  /** So the calendar can bring this routine into view. */
  readonly id?: string;
  readonly title: string;
  /** The routine's instructions; their start says what it does. */
  readonly prompt: string;
  /** When it runs and when it runs next, in plain words. */
  readonly when: string;
  /** How its last run went and when; null before the first one. */
  readonly lastRun: RoutineLastRun | null;
  /** What to do about a skipped run, after the status. */
  readonly lastRunRemedy?: ReactNode;
  /** Where its runs arrive, and the way to change that. */
  readonly place?: ReactNode;
  readonly controls: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Entry
      title={title}
      meta={when}
      actions={controls}
      data-routine={title}
      {...(id === undefined
        ? {}
        : { id, tabIndex: -1, className: "scroll-mt-4 outline-none focus:bg-accent/40" })}
    >
      <Muted className={cn("break-words", open ? "whitespace-pre-wrap" : "line-clamp-2")}>
        {prompt}
      </Muted>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
        className="-mx-2 w-fit cursor-pointer rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {open ? "Hide instructions" : "Show instructions"}
      </button>
      {lastRun ? (
        <StatusLine tone={lastRun.tone} data-routine-last-run={lastRun.tone}>
          {lastRun.text}
          {lastRunRemedy ? <>. {lastRunRemedy}</> : null}
        </StatusLine>
      ) : null}
      {lastRun?.details ? (
        <Disclosure summary="Details">
          <p className="break-words whitespace-pre-wrap">{lastRun.details}</p>
        </Disclosure>
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
