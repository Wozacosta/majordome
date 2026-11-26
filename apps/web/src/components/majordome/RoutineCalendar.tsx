import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";
import {
  BellIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDotIcon,
  CircleIcon,
  CircleSlashIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Section } from "./paper";
import {
  buildWeek,
  CALENDAR_RUN_STATE_WORDS,
  type CalendarRun,
  type CalendarRunState,
  runTimeWords,
  weekBounds,
  weekRangeWords,
} from "./routineCalendar.logic";
import type { RoutineItem, RoutinesHold } from "./routines.logic";
import type { MajordomeVault } from "./topics.logic";
import { useRoutineRunLog } from "./useRoutineRunLog";

const MARK: Record<CalendarRunState, { readonly Icon: typeof CheckIcon; readonly tone: string }> = {
  done: { Icon: CheckIcon, tone: "text-success-foreground" },
  failed: { Icon: XIcon, tone: "text-destructive-foreground" },
  skipped: { Icon: CircleSlashIcon, tone: "text-warning-foreground" },
  stopped: { Icon: SquareIcon, tone: "text-muted-foreground" },
  running: { Icon: CircleDotIcon, tone: "text-primary" },
  upcoming: { Icon: CircleIcon, tone: "text-muted-foreground/70" },
};

// One line where the days are a list; the time over the name where they are columns.
const RUN_CLASS =
  "grid w-full min-w-0 grid-cols-[5.25rem_1fr] items-baseline rounded-md px-1.5 py-1 text-start text-xs outline-none @lg:block @lg:px-0.5";
const RUN_ACTION_CLASS =
  "cursor-pointer hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * The week on the Routines page: each day's runs, the ones that happened with how they went and
 * the ones still to come. Seven columns where they fit, the days as a list where they don't.
 */
export function RoutineCalendar({
  vault,
  routines,
  reminders,
  fired,
  hold,
  nowMs,
  onOpenRoutine,
}: {
  readonly vault: Pick<MajordomeVault, "copies">;
  readonly routines: ReadonlyArray<RoutineItem>;
  readonly reminders: ReadonlyArray<RoutineItem>;
  /** Reminders that went off. */
  readonly fired: ReadonlyArray<RoutineItem>;
  readonly hold: RoutinesHold | null;
  readonly nowMs: number;
  /** Shows a routine in the list under the calendar. */
  readonly onOpenRoutine: (item: RoutineItem) => void;
}) {
  const [weeksFromNow, setWeeksFromNow] = useState(0);
  const bounds = weekBounds(nowMs, weeksFromNow);
  const logged = useRoutineRunLog(vault, {
    fromMs: bounds[0]!,
    untilMs: bounds.at(-1)!,
    nowMs,
  });
  const days = buildWeek({ bounds, nowMs, routines, reminders, fired, logged, hold });
  const weekdayWords = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const dayWords = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <Section
      label={weekRangeWords(bounds)}
      data-routine-calendar
      action={
        <span className="flex items-center gap-0.5">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Previous week"
            onClick={() => setWeeksFromNow((weeks) => weeks - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={weeksFromNow === 0}
            onClick={() => setWeeksFromNow(0)}
          >
            Today
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Next week"
            onClick={() => setWeeksFromNow((weeks) => weeks + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </span>
      }
    >
      <div className="@container">
        <ol className="m-0 grid list-none grid-cols-1 p-0 @lg:grid-cols-7 @lg:gap-1">
          {days.map((day) => (
            <li
              key={day.key}
              data-day={day.key}
              aria-current={day.today ? "date" : undefined}
              aria-label={dayWords.format(day.startMs)}
              className={cn(
                "flex min-w-0 gap-2 border-t border-border py-1.5",
                "@lg:min-h-28 @lg:flex-col @lg:gap-1 @lg:rounded-lg @lg:border @lg:p-0.5",
                day.today && "@lg:border-primary/70",
              )}
            >
              <p
                className={cn(
                  "flex w-14 shrink-0 items-baseline gap-1.5 px-1.5 py-1 text-xs text-muted-foreground @lg:w-auto @lg:px-0.5",
                  day.today && "font-semibold text-primary",
                )}
              >
                {weekdayWords.format(day.startMs)}
                <span className={cn("tabular-nums", !day.today && "text-foreground")}>
                  {new Date(day.startMs).getDate()}
                </span>
              </p>
              <ul className="m-0 flex min-w-0 flex-1 list-none flex-col p-0">
                {day.runs.map((run) => (
                  <li key={run.key} className="min-w-0">
                    <CalendarRunLine run={run} onOpenRoutine={onOpenRoutine} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

function CalendarRunLine({
  run,
  onOpenRoutine,
}: {
  readonly run: CalendarRun;
  readonly onOpenRoutine: (item: RoutineItem) => void;
}) {
  const { item, state } = run;
  const { task } = item;
  const time = runTimeWords(run.atMs);
  const words = CALENDAR_RUN_STATE_WORDS[state];
  const { Icon, tone } =
    run.reminder && state === "upcoming" ? { ...MARK.upcoming, Icon: BellIcon } : MARK[state];
  const label = `${time}, ${task.title}, ${words}${run.count > 1 ? `, ${run.count} runs` : ""}`;
  const content = (
    <>
      <span className="flex items-center gap-1 overflow-hidden whitespace-nowrap text-muted-foreground tabular-nums @lg:gap-0.5 @lg:text-2xs @lg:tracking-tight">
        <Icon className={cn("size-3 shrink-0 @lg:size-2.5", tone)} aria-hidden />
        {time}
      </span>
      <span className="block min-w-0 truncate font-medium text-foreground @lg:line-clamp-3 @lg:break-words @lg:whitespace-normal">
        {task.title}
        {run.count > 1 ? (
          <span className="font-normal text-muted-foreground"> ×{run.count}</span>
        ) : null}
      </span>
    </>
  );
  const shared = {
    "data-run": task.title,
    "data-run-state": state,
    "aria-label": label,
    title: words,
  };
  // A run that happened opens its chat; one still to come opens what will run.
  if (state !== "upcoming" && task.threadId !== null) {
    return (
      <Link
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams(scopeThreadRef(item.environmentId, task.threadId))}
        className={cn(RUN_CLASS, RUN_ACTION_CLASS)}
        {...shared}
      >
        {content}
      </Link>
    );
  }
  if (run.reminder) {
    return state === "upcoming" ? (
      <Link to="/reminders" className={cn(RUN_CLASS, RUN_ACTION_CLASS)} {...shared}>
        {content}
      </Link>
    ) : (
      <div className={RUN_CLASS} {...shared}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cn(RUN_CLASS, RUN_ACTION_CLASS)}
      onClick={() => onOpenRoutine(item)}
      {...shared}
    >
      {content}
    </button>
  );
}
