import type { ReactNode } from "react";
import {
  EnvironmentId,
  type MajordomeReadyRoutine,
  ProjectId,
  type ScheduledTask,
  ScheduledTaskId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import type { ComposerHandleRef } from "../../composerHandleContext";
import { majordomeEnvironment } from "../../state/majordome";
import { serverEnvironment } from "../../state/server";
import { SidebarProvider } from "../ui/sidebar";
import { AssistantDock } from "./AssistantDock";
import { RemindersPage } from "./RemindersPage";
import { RoutinesPage } from "./RoutinesPage";

const environmentId = EnvironmentId.make("env-mac");
const projectId = ProjectId.make("notes");
const copy = { environmentId, projectId, routinesThreadId: null };

const task = (id: string, overrides: Partial<ScheduledTask>) =>
  ({
    id: ScheduledTaskId.make(id),
    title: id,
    prompt: "Open today's daily note and list what is due.",
    projectId,
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "08:00" },
    nextRunAt: "2026-11-17T08:00:00.000Z",
    lastRunAt: "2026-11-16T08:00:00.000Z",
    lastRunStatus: "succeeded",
    lastRunError: null,
    threadId: null,
    ...overrides,
  }) as ScheduledTask;

const state = vi.hoisted(() => ({
  typed: [] as Array<string>,
  commands: [] as Array<readonly [unknown, unknown]>,
  /** False for a notes folder with no routine in it. */
  hasRoutines: true,
  /** What the server still offers ready-made. */
  ready: [] as Array<unknown>,
  readyAtom: {},
}));

const ready = (key: string, title: string, rest: Partial<MajordomeReadyRoutine> = {}) =>
  ({
    key,
    title,
    description: "Asks one question about your day.",
    when: "Every day at 21:00",
    ...rest,
  }) as MajordomeReadyRoutine;

vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-11-16T09:00" }));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: (atom: unknown) =>
    atom === state.readyAtom ? AsyncResult.success({ routines: state.ready }) : true,
}));
vi.mock("../../state/majordome", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../state/majordome")>();
  return {
    ...real,
    majordomeEnvironment: { ...real.majordomeEnvironment, readyRoutines: () => state.readyAtom },
  };
});
vi.mock("../../state/entities", () => ({ useQuietThreadShell: () => null }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => (value: unknown) => {
    state.commands.push([command, value]);
    return Promise.resolve({ _tag: "Success", value: { task: { threadId: null } } });
  },
}));
vi.mock("./useMachineNames", () => ({ useMachineNames: () => ({ machineOf: () => "This Mac" }) }));
vi.mock("./RoutineLimits", () => ({ RoutineLimits: () => null }));
vi.mock("./RoutinesBlockedLine", () => ({ RoutinesBlockedLine: () => null }));
vi.mock("./useMajordomeVaults", () => ({
  useMajordomeVaults: () => ({
    activeVault: { key: "brain", copies: [copy], topics: [] },
    copies: [],
    loading: false,
  }),
}));
vi.mock("./useVaultRoutines", () => ({
  useVaultRoutines: () => ({
    routines: state.hasRoutines
      ? [
          { key: "start", environmentId, task: task("Start my day", {}), timeZone: undefined },
          {
            key: "hook",
            environmentId,
            timeZone: undefined,
            task: task("From the shop", {
              schedule: { type: "webhook", signature: null },
              nextRunAt: null,
              lastRunStatus: "never",
            }),
          },
        ]
      : [],
    reminders: state.hasRoutines
      ? [
          {
            key: "bank",
            environmentId,
            timeZone: undefined,
            task: task("Call the bank", {
              schedule: { type: "once", runAt: "2026-11-17T10:00:00.000Z" },
              nextRunAt: "2026-11-17T10:00:00.000Z",
            }),
          },
        ]
      : [],
    fired: [],
    runner: copy,
    runnerHistory: null,
    runnerUnreachable: false,
    loading: false,
  }),
}));
vi.mock("./useRoutineRunLog", () => ({ useRoutineRunLog: () => [] }));
// The real panel mounts the whole conversation view; this one only takes the words Edit hands it.
vi.mock("./RoutinesAssistant", () => ({
  RoutinesAssistant: (props: { composerRef: ComposerHandleRef; back: ReactNode }) => {
    props.composerRef.current = {
      insertTextAtEnd: (text: string) => state.typed.push(text) > 0,
      focusAtEnd: () => {},
    } as never;
    return (
      <section aria-label="Assistant">
        {props.back}
        <p>The conversation</p>
      </section>
    );
  },
}));

async function setup(width: number) {
  state.typed.length = 0;
  state.commands.length = 0;
  state.hasRoutines = true;
  state.ready = [];
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 800);
  return { [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height) };
}

// The page as the app shows it: inside the dock that puts the assistant beside every screen.
const routinesPage = (
  <SidebarProvider>
    <AssistantDock className="h-dvh">
      <RoutinesPage />
    </AssistantDock>
  </SidebarProvider>
);

it("lists reminders on their own page", async () => {
  await using _viewport = await setup(1280);
  await using screen = await render(
    <SidebarProvider>
      <RemindersPage />
    </SidebarProvider>,
  );
  const reminder = screen.getByRole("list", { name: "Reminders" }).getByRole("listitem");
  await expect.element(reminder.getByText("Call the bank", { exact: true })).toBeVisible();
  await expect.element(reminder.getByText(/ · in 1 day$/)).toBeVisible();
  await expect.element(screen.getByRole("list", { name: "Routines" })).not.toBeInTheDocument();
});

it("lists routines in plain words, with the assistant beside them", async () => {
  await using _viewport = await setup(1280);
  await using screen = await render(routinesPage);

  const routine = screen.getByRole("list", { name: "Routines" }).getByRole("listitem").first();
  await expect.element(routine.getByText("Start my day")).toBeVisible();
  await expect
    .element(routine.getByText(/^Every day at 8:00( AM)? · Next in 23 hours/))
    .toBeVisible();
  await expect.element(routine.getByText(/^Open today's daily note/)).toBeVisible();
  await expect.element(routine.getByText(/^Last run went well/)).toBeVisible();
  // A task another service calls is still a routine, not an error; it has nothing to run now.
  const outside = screen.getByRole("list", { name: "Routines" }).getByRole("listitem").nth(1);
  await expect.element(outside.getByText("When something arrives")).toBeVisible();
  await expect.element(outside.getByRole("button", { name: "Run now" })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("list", { name: "Reminders" })).not.toBeInTheDocument();

  await expect.element(screen.getByRole("region", { name: "Assistant" })).toBeVisible();
  // Hidden, so it is out of the page for a screen reader too.
  await expect
    .element(screen.getByRole("button", { name: "Assistant", exact: true }))
    .not.toBeInTheDocument();

  await routine.getByRole("button", { name: "Run now" }).click();
  await routine.getByRole("switch").click();
  expect(state.commands).toEqual([
    [serverEnvironment.runScheduledTaskNow, { environmentId, input: { id: "Start my day" } }],
    [
      serverEnvironment.setScheduledTaskEnabled,
      { environmentId, input: { id: "Start my day", enabled: false } },
    ],
  ]);
});

it("on a phone, shows the list first and opens the assistant over it", async () => {
  await using _viewport = await setup(390);
  await using screen = await render(routinesPage);

  const assistant = screen.getByRole("region", { name: "Assistant" });
  const heading = screen.getByRole("heading", { name: "Routines", level: 1 });
  await expect.element(heading).toBeVisible();
  await expect.element(assistant).not.toBeInTheDocument();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);

  await screen.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect.element(assistant).toBeVisible();
  await expect.element(heading).not.toBeInTheDocument();
  await assistant.getByRole("button", { name: "Back to the page" }).click();
  await expect.element(heading).toBeVisible();

  // Edit hands the routine to the assistant instead of opening a form.
  await screen
    .getByRole("list", { name: "Routines" })
    .getByRole("listitem")
    .first()
    .getByRole("button", { name: "Edit" })
    .click();
  await expect.element(assistant).toBeVisible();
  expect(state.typed).toEqual(["I'd like to change my routine “Start my day”: "]);
});

it("offers ready-made routines as cards under the list, each adding the routine it names", async () => {
  await using _viewport = await setup(1280);
  state.ready = [
    ready("evening-journal", "Evening journal prompt"),
    ready("inbox-summary", "What needs a reply", { needs: "Gmail", when: "Weekdays at 8:15" }),
    ready("from-a-newer-server", "Something new"),
  ];
  await using screen = await render(routinesPage);

  // The list keeps its place; the cards come after it.
  await expect.element(screen.getByRole("list", { name: "Routines" })).toBeVisible();
  const cards = screen.getByRole("list", { name: "Add a routine" }).getByRole("listitem");
  await expect.element(cards).toHaveLength(4);
  const journal = cards.first();
  await expect.element(journal.getByText("Evening journal prompt")).toBeVisible();
  await expect
    .element(journal.getByText("Every day at 21:00, asks one question about your day."))
    .toBeVisible();
  await expect.element(cards.nth(1).getByText("Needs Gmail connected")).toBeVisible();
  // Each has its own drawing; one this version does not know gets the plain one.
  expect(
    [...document.querySelectorAll("[data-routine-drawing]")].map((drawing) =>
      drawing.getAttribute("data-routine-drawing"),
    ),
  ).toEqual(["evening-journal", "inbox-summary", "message", "own"]);

  for (const title of ["Evening journal prompt", "What needs a reply", "Something new"]) {
    // The cards are off while one is being added, so each click waits for the one before.
    await screen.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  }
  expect(state.commands).toEqual(
    ["evening-journal", "inbox-summary", "from-a-newer-server"].map((key) => [
      majordomeEnvironment.addReadyRoutine,
      { environmentId, input: { projectId, key } },
    ]),
  );

  // The last card is the way to describe one in words.
  await screen.getByRole("button", { name: /^Your own/ }).click();
  expect(state.typed).toEqual(["I'd like a new routine: "]);
});

it("makes the cards the page when there is no routine yet", async () => {
  await using _viewport = await setup(390);
  state.hasRoutines = false;
  state.ready = [ready("evening-journal", "Evening journal prompt")];
  await using screen = await render(routinesPage);

  const cards = screen.getByRole("list", { name: "Start with a routine" }).getByRole("listitem");
  await expect.element(cards).toHaveLength(2);
  await expect.element(screen.getByRole("list", { name: "Routines" })).not.toBeInTheDocument();
  await expect.element(screen.getByText("No routines yet")).not.toBeInTheDocument();
  // Two to a row on a phone, without the page scrolling sideways.
  const [first, second] = cards.elements().map((card) => card.getBoundingClientRect());
  expect(first?.top).toBe(second?.top);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);

  await screen.getByRole("button", { name: /^Evening journal prompt/ }).click();
  expect(state.commands).toEqual([
    [
      majordomeEnvironment.addReadyRoutine,
      { environmentId, input: { projectId, key: "evening-journal" } },
    ],
  ]);
});
