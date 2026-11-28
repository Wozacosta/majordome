/** One routine's row in the Chats list: its latest run, with the earlier ones folded under it. */
export interface RoutineFold {
  readonly id: string;
  readonly title: string;
  readonly sideThreadIds: ReadonlyArray<string>;
}

export const routineFoldId = (title: string) => `routine:${title}`;

/**
 * The chats that are a routine's, by thread id, each with the routine's name: the chat a routine
 * keeps, and the ones it opened on each run before it kept one, which carry its name and were not
 * started by the owner. One-time reminders are left as ordinary chats.
 */
export function routineChats(
  tasks: ReadonlyArray<{
    readonly title: string;
    readonly threadId: string | null;
    readonly schedule: { readonly type: string };
  }>,
  threads: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly createdBy: string;
  }>,
): ReadonlyMap<string, string> {
  const titles = new Set<string>();
  const found = new Map<string, string>();
  for (const task of tasks) {
    if (task.schedule.type === "once") continue;
    titles.add(task.title);
    if (task.threadId !== null) found.set(task.threadId, task.title);
  }
  for (const thread of threads) {
    if (thread.createdBy !== "user" && titles.has(thread.title) && !found.has(thread.id)) {
      found.set(thread.id, thread.title);
    }
  }
  return found;
}

/**
 * The Chats list with a routine's chats gathered: the hidden routines' chats are left out, and of
 * each other routine the first listed chat (its latest run) carries the rest as its fold.
 * `threadIdOf` answers null for a row that stays as it is.
 */
export function gatherRoutineChats<T>(
  items: ReadonlyArray<T>,
  threadIdOf: (item: T) => string | null,
  routineOf: ReadonlyMap<string, string>,
  hidden: ReadonlySet<string>,
): { readonly items: Array<T>; readonly byThread: ReadonlyMap<string, RoutineFold> } {
  const kept: Array<T> = [];
  const groups = new Map<string, Array<string>>();
  for (const item of items) {
    const id = threadIdOf(item);
    const title = id === null ? undefined : routineOf.get(id);
    if (id === null || title === undefined) {
      kept.push(item);
      continue;
    }
    if (hidden.has(title)) continue;
    kept.push(item);
    groups.set(title, [...(groups.get(title) ?? []), id]);
  }
  const byThread = new Map<string, RoutineFold>();
  for (const [title, [first, ...rest]] of groups) {
    if (first !== undefined) {
      byThread.set(first, { id: routineFoldId(title), title, sideThreadIds: rest });
    }
  }
  return { items: kept, byThread };
}

/** One routine as Today lists it, small enough to keep on the phone for when there is no connection. */
export interface RoutineRow {
  readonly id: string;
  readonly title: string;
  /** The chat it keeps; null until its first run, or when each run opens its own. */
  readonly threadId: string | null;
  readonly enabled: boolean;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastRunStatus: string;
  /** The last run did not happen: the computer was off at the time. */
  readonly missed?: boolean;
}

/** The routines among a computer's scheduled tasks; one-time reminders are not routines. */
export function routineRows(
  tasks: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly threadId: string | null;
    readonly enabled: boolean;
    readonly schedule: { readonly type: string };
    readonly nextRunAt: string | null;
    readonly lastRunAt: string | null;
    readonly lastRunStatus: string;
    readonly lastRunErrorCode?: string | undefined;
  }>,
): ReadonlyArray<RoutineRow> {
  return tasks
    .filter((task) => task.schedule.type !== "once")
    .map((task) => ({
      id: String(task.id),
      title: task.title,
      threadId: task.threadId === null ? null : String(task.threadId),
      enabled: task.enabled,
      nextRunAt: task.nextRunAt,
      lastRunAt: task.lastRunAt,
      lastRunStatus: task.lastRunStatus,
      ...(task.lastRunErrorCode === "missed" ? { missed: true } : {}),
    }));
}

const two = (value: number) => String(value).padStart(2, "0");
const dayOf = (at: Date) => `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
const timeOf = (at: Date) => `${two(at.getHours())}:${two(at.getMinutes())}`;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const moment = (iso: string | null) => {
  if (iso === null) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
};

/** The routine's run on `day`, when its last one was that day. */
function runOn(routine: RoutineRow, day: string): Date | null {
  const at = routine.lastRunStatus === "never" ? null : moment(routine.lastRunAt);
  return at !== null && dayOf(at) === day ? at : null;
}

function daysBetween(from: string, to: string): number {
  const utc = (day: string) => {
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** When a routine runs next, as short as the row allows: "Today 18:00", "Sun 18:00", "6 Dec 18:00". */
export function nextRunLabel(nextRunAt: string, today: string): string | null {
  const at = moment(nextRunAt);
  if (at === null) return null;
  const time = timeOf(at);
  const days = daysBetween(today, dayOf(at));
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days < 7) return `${WEEKDAYS[at.getDay()]} ${time}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${time}`;
}

export interface RoutineStatus {
  readonly text: string;
  /** A run that failed or did not happen stands out; the rest stays quiet. */
  readonly tone: "quiet" | "warning";
}

/** What a routine's row says for the day shown: how its run that day went, or when it runs next. */
export function routineStatus(
  routine: RoutineRow,
  day: string,
  today: string,
): RoutineStatus | null {
  const ran = runOn(routine, day);
  if (ran !== null) {
    const time = timeOf(ran);
    if (routine.lastRunStatus === "running") return { text: "Running", tone: "quiet" };
    if (routine.lastRunStatus === "failed") {
      return { text: `${routine.missed ? "Missed" : "Failed"} ${time}`, tone: "warning" };
    }
    return { text: `Done ${time}`, tone: "quiet" };
  }
  if (!routine.enabled) return { text: "Paused", tone: "quiet" };
  const next = routine.nextRunAt === null ? null : nextRunLabel(routine.nextRunAt, today);
  return next === null ? null : { text: next, tone: "quiet" };
}

/**
 * The routines for the day shown, the hidden ones apart. Today lists them all; another day only
 * those that ran or will run on it, since a routine only remembers its last run.
 */
export function routinesForDay(
  routines: ReadonlyArray<RoutineRow>,
  day: string,
  today: string,
  hidden: ReadonlyArray<string>,
): { readonly shown: ReadonlyArray<RoutineRow>; readonly hidden: ReadonlyArray<RoutineRow> } {
  const ofDay =
    day === today
      ? routines
      : routines.filter((routine) => {
          const next = routine.enabled ? moment(routine.nextRunAt) : null;
          return runOn(routine, day) !== null || (next !== null && dayOf(next) === day);
        });
  return {
    shown: ofDay.filter((routine) => !hidden.includes(routine.title)),
    hidden: ofDay.filter((routine) => hidden.includes(routine.title)),
  };
}

/** The hidden routines' names with one added or taken out. */
export function withRoutineHidden(
  hidden: ReadonlyArray<string>,
  title: string,
  hide: boolean,
): ReadonlyArray<string> {
  const others = hidden.filter((name) => name !== title);
  return hide ? [...others, title] : others;
}

/**
 * The one routine worth a few words on the home page: today's latest run ("Morning brief done"),
 * or else the next one due today ("Review my week at 18:00"). Null when neither.
 */
export function routineHeadline(
  routines: ReadonlyArray<RoutineRow>,
  today: string,
  hidden: ReadonlyArray<string>,
): string | null {
  let latest: { readonly routine: RoutineRow; readonly at: Date } | null = null;
  let next: { readonly routine: RoutineRow; readonly at: Date } | null = null;
  for (const routine of routines) {
    if (hidden.includes(routine.title)) continue;
    const ran = runOn(routine, today);
    if (ran !== null && (latest === null || ran > latest.at)) latest = { routine, at: ran };
    const due = routine.enabled ? moment(routine.nextRunAt) : null;
    if (due !== null && dayOf(due) === today && (next === null || due < next.at)) {
      next = { routine, at: due };
    }
  }
  if (latest !== null) {
    const { routine } = latest;
    const how =
      routine.lastRunStatus === "running"
        ? "running"
        : routine.lastRunStatus === "failed"
          ? routine.missed
            ? "missed"
            : "failed"
          : "done";
    return `${routine.title} ${how}`;
  }
  return next === null ? null : `${next.routine.title} at ${timeOf(next.at)}`;
}
