import {
  EnvironmentId,
  type MajordomeRoutineRun,
  ProjectId,
  type ScheduledTask,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { RoutineCalendar } from "./RoutineCalendar";
import type { RoutineItem } from "./routines.logic";

const environmentId = EnvironmentId.make("env-mac");
const projectId = ProjectId.make("notes");
const vault = { copies: [{ environmentId, projectId, routinesThreadId: null }] } as never;
/** Thursday 26 November 2026, at noon wherever the test runs. */
const NOW = new Date(2026, 10, 26, 12, 0).getTime();
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString();

const item = (id: string, overrides: Partial<ScheduledTask>): RoutineItem => ({
  key: `${environmentId}:${id}`,
  environmentId,
  timeZone: undefined,
  task: {
    id: ScheduledTaskId.make(id),
    title: id,
    projectId,
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "08:00" },
    nextRunAt: at(27, 8),
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    threadId: null,
    ...overrides,
  } as ScheduledTask,
});

const morning = item("Start my day", {
  lastRunAt: at(26, 8),
  lastRunStatus: "succeeded",
  threadId: ThreadId.make("thread-morning"),
});
const review = item("Review my week", {
  schedule: { type: "fixed_time", timeOfDay: "18:00", weekdays: [0] },
  nextRunAt: at(29, 18),
});
const bank = item("Call the bank", {
  schedule: { type: "once", runAt: at(27, 9) },
  nextRunAt: at(27, 9),
});

const log = vi.hoisted(() => ({
  runs: [] as Array<{ itemKey: string; run: MajordomeRoutineRun }>,
  ranges: [] as Array<{ fromMs: number; untilMs: number }>,
}));
vi.mock("./useRoutineRunLog", () => ({
  useRoutineRunLog: (_vault: unknown, range: { fromMs: number; untilMs: number }) => {
    log.ranges.push(range);
    return log.runs.filter(
      ({ run }) => Date.parse(run.at) >= range.fromMs && Date.parse(run.at) < range.untilMs,
    );
  },
}));

async function setup(width: number) {
  log.ranges.length = 0;
  log.runs = [
    {
      itemKey: morning.key,
      run: { taskId: morning.task.id, at: at(25, 8), status: "failed", errorCode: "missed" },
    },
    { itemKey: morning.key, run: { taskId: morning.task.id, at: at(24, 8), status: "failed" } },
  ];
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 800);
  return { [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height) };
}

const opened: Array<string> = [];
const calendar = (
  <RoutineCalendar
    vault={vault}
    routines={[morning, review]}
    reminders={[bank]}
    fired={[]}
    hold={null}
    nowMs={NOW}
    onOpenRoutine={(routine) => opened.push(routine.task.title)}
  />
);

const runsOn = (screen: Awaited<ReturnType<typeof render>>, day: string) =>
  [...screen.container.querySelectorAll(`[data-day="${day}"] [data-run]`)].map(
    (run) => `${run.getAttribute("data-run")}: ${run.getAttribute("data-run-state")}`,
  );

it("shows the week: what ran, how it went, and what is still to come", async () => {
  await using _viewport = await setup(1280);
  await using screen = await render(<div className="w-[720px]">{calendar}</div>);

  const today = screen.container.querySelector('[aria-current="date"]');
  expect(today?.getAttribute("data-day")).toBe("2026-11-26");
  expect(runsOn(screen, "2026-11-23")).toEqual([]);
  expect(runsOn(screen, "2026-11-24")).toEqual(["Start my day: failed"]);
  expect(runsOn(screen, "2026-11-25")).toEqual(["Start my day: skipped"]);
  expect(runsOn(screen, "2026-11-26")).toEqual(["Start my day: done"]);
  expect(runsOn(screen, "2026-11-27")).toEqual([
    "Start my day: upcoming",
    "Call the bank: upcoming",
  ]);
  expect(runsOn(screen, "2026-11-29")).toEqual([
    "Start my day: upcoming",
    "Review my week: upcoming",
  ]);

  // Seven columns side by side.
  const days = [...screen.container.querySelectorAll("[data-day]")];
  expect(new Set(days.map((day) => Math.round(day.getBoundingClientRect().top))).size).toBe(1);

  // A run that happened opens its chat; one to come shows the routine; a reminder its page.
  const done = screen.getByRole("link", { name: /Start my day, Done$/ });
  await expect.element(done).toHaveAttribute("href", "/env-mac/thread-morning");
  await expect
    .element(screen.getByRole("link", { name: /Call the bank, Coming up$/ }))
    .toHaveAttribute("href", "/reminders");
  await screen.getByRole("button", { name: /Review my week, Coming up$/ }).click();
  expect(opened).toEqual(["Review my week"]);
});

it("moves a week at a time and comes back to today", async () => {
  await using _viewport = await setup(1280);
  await using screen = await render(<div className="w-[720px]">{calendar}</div>);
  const todayButton = screen.getByRole("button", { name: "Today" });
  await expect.element(todayButton).toBeDisabled();

  await screen.getByRole("button", { name: "Next week" }).click();
  expect(screen.container.querySelector('[aria-current="date"]')).toBeNull();
  expect(runsOn(screen, "2026-11-30")).toEqual(["Start my day: upcoming"]);
  expect(runsOn(screen, "2026-12-06")).toEqual([
    "Start my day: upcoming",
    "Review my week: upcoming",
  ]);
  expect(screen.container.querySelector('[data-run="Call the bank"]')).toBeNull();

  await todayButton.click();
  await screen.getByRole("button", { name: "Previous week" }).click();
  expect(runsOn(screen, "2026-11-22")).toEqual([]);
  expect(screen.container.querySelectorAll("[data-run]")).toHaveLength(0);

  await todayButton.click();
  expect(runsOn(screen, "2026-11-26")).toEqual(["Start my day: done"]);
  await expect.element(todayButton).toBeDisabled();
});

it("on a phone, stacks the days and stays inside the screen", async () => {
  await using _viewport = await setup(390);
  await using screen = await render(<div className="px-5">{calendar}</div>);
  const days = [...screen.container.querySelectorAll("[data-day]")];
  expect(days).toHaveLength(7);
  expect(new Set(days.map((day) => Math.round(day.getBoundingClientRect().top))).size).toBe(7);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  await expect.element(screen.getByRole("link", { name: /Start my day, Done$/ })).toBeVisible();
});
