import { EnvironmentId, ProjectId, type ScheduledTask, ScheduledTaskId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import type { ComposerHandleRef } from "../../composerHandleContext";
import { serverEnvironment } from "../../state/server";
import { SidebarProvider } from "../ui/sidebar";
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
    lastRunStatus: "succeeded",
    lastRunError: null,
    threadId: null,
    ...overrides,
  }) as ScheduledTask;

const state = vi.hoisted(() => ({
  typed: [] as Array<string>,
  commands: [] as Array<readonly [unknown, unknown]>,
}));

vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-11-16T09:00" }));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => true,
}));
vi.mock("../../state/entities", () => ({ useQuietThreadShell: () => null }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => (value: unknown) => {
    state.commands.push([command, value]);
    return Promise.resolve({ _tag: "Success" });
  },
}));
vi.mock("./useMachineNames", () => ({ useMachineNames: () => ({ machineOf: () => "This Mac" }) }));
vi.mock("./RoutineLimits", () => ({ RoutineLimits: () => null }));
vi.mock("./RoutinesBlockedLine", () => ({ RoutinesBlockedLine: () => null }));
vi.mock("./useMajordomeVaults", () => ({
  useMajordomeVaults: () => ({ activeVault: { key: "brain", copies: [copy] }, loading: false }),
}));
vi.mock("./useVaultRoutines", () => ({
  useVaultRoutines: () => ({
    routines: [
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
    ],
    reminders: [
      {
        key: "bank",
        environmentId,
        timeZone: undefined,
        task: task("Call the bank", {
          schedule: { type: "once", runAt: "2026-11-17T10:00:00.000Z" },
          nextRunAt: "2026-11-17T10:00:00.000Z",
        }),
      },
    ],
    runner: copy,
    runnerHistory: null,
    runnerUnreachable: false,
    loading: false,
  }),
}));
// The real panel mounts the whole conversation view; this one only takes the words Edit hands it.
vi.mock("./RoutinesAssistant", () => ({
  RoutinesAssistant: (props: { composerRef: ComposerHandleRef; onBack: () => void }) => {
    props.composerRef.current = {
      insertTextAtEnd: (text: string) => state.typed.push(text) > 0,
      focusAtEnd: () => {},
    } as never;
    return (
      <section aria-label="Assistant">
        <button type="button" onClick={props.onBack}>
          Back to routines
        </button>
      </section>
    );
  },
}));

async function setup(width: number) {
  state.typed.length = 0;
  state.commands.length = 0;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 800);
  return { [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height) };
}

const routinesPage = (
  <SidebarProvider>
    <RoutinesPage />
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
  await expect.element(routine.getByText("Every day at 8:00 · Next in 23 hours")).toBeVisible();
  await expect.element(routine.getByText(/^Open today's daily note/)).toBeVisible();
  await expect.element(routine.getByText("Last run went well")).toBeVisible();
  // A task another service calls is still a routine, not an error; it has nothing to run now.
  const outside = screen.getByRole("list", { name: "Routines" }).getByRole("listitem").nth(1);
  await expect.element(outside.getByText("Runs when called from outside")).toBeVisible();
  await expect.element(outside.getByRole("button", { name: "Run now" })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("list", { name: "Reminders" })).not.toBeInTheDocument();

  await expect.element(screen.getByRole("region", { name: "Assistant" })).toBeVisible();
  // Hidden, so it is out of the page for a screen reader too.
  await expect
    .element(screen.getByRole("button", { name: "Set up with the assistant" }))
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

  await screen.getByRole("button", { name: "Set up with the assistant" }).click();
  await expect.element(assistant).toBeVisible();
  await expect.element(heading).not.toBeInTheDocument();
  await assistant.getByRole("button", { name: "Back to routines" }).click();
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
