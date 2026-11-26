import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { InFlightGroups } from "./InFlight";
import type { InFlightRow } from "./inFlight.logic";

const row = (title: string, rest: Partial<InFlightRow> = {}): InFlightRow => ({
  key: `env-mac:${title}`,
  environmentId: EnvironmentId.make("env-mac"),
  threadId: ThreadId.make(title),
  title,
  place: null,
  mark: "working",
  state: "Working",
  alerted: false,
  ...rest,
});

const groups = (screen: Awaited<ReturnType<typeof render>>) =>
  [...screen.container.querySelectorAll("[data-in-flight]")].map((group) => [
    group.querySelector("h2")?.textContent,
    [...group.querySelectorAll("[data-in-flight-row]")].map((item) => item.textContent),
  ]);

it("lists what needs the owner above what is being worked on, each row opening its chat", async () => {
  await using screen = await render(
    <div className="w-[640px]">
      <InFlightGroups
        inFlight={{
          needsYou: [
            row("Plan the trip", { mark: "asking", state: "Waiting for your answer" }),
            row("Which form?", { mark: "answered", state: "New reply", place: "Taxes" }),
          ],
          working: [row("Find a dentist")],
        }}
      />
    </div>,
  );
  expect(groups(screen)).toEqual([
    ["Needs you2", ["Plan the tripWaiting for your answer", "Which form?TaxesNew reply"]],
    ["Working1", ["Find a dentistWorking"]],
  ]);
  await expect
    .element(screen.getByRole("link", { name: /Plan the trip/ }))
    .toHaveAttribute("href", "/env-mac/Plan%20the%20trip");
});

it("shows only the groups that have something, and nothing at all when none has", async () => {
  await using screen = await render(
    <InFlightGroups inFlight={{ needsYou: [], working: [row("Find a dentist")] }} />,
  );
  expect(groups(screen).map(([title]) => title)).toEqual(["Working1"]);
  await screen.rerender(<InFlightGroups inFlight={{ needsYou: [], working: [] }} />);
  expect(screen.container.textContent).toBe("");
});

it("keeps a long group short until asked for the rest, and folds it back", async () => {
  const working = ["One", "Two", "Three", "Four", "Five"].map((title) => row(title));
  await using screen = await render(<InFlightGroups inFlight={{ needsYou: [], working }} />);
  const shown = () => screen.container.querySelectorAll("[data-in-flight-row]").length;
  expect(shown()).toBe(3);
  await screen.getByRole("button", { name: "+2 more" }).click();
  expect(shown()).toBe(5);
  await screen.getByRole("button", { name: "Show fewer" }).click();
  expect(shown()).toBe(3);
});

it("keeps the state in view at phone width, where a long title is cut short", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(390, 800);
  try {
    await using screen = await render(
      <div className="w-[350px]">
        <InFlightGroups
          inFlight={{
            needsYou: [
              row("Summarise the open hiring loops for the design lead role and the rest", {
                mark: "asking",
                state: "Waiting for your answer",
                place: "Hiring",
              }),
            ],
            working: [],
          }}
        />
      </div>,
    );
    const link = screen.container.querySelector("a");
    const state = [...(link?.querySelectorAll("span") ?? [])].at(-1);
    const box = link?.getBoundingClientRect();
    const stateBox = state?.getBoundingClientRect();
    expect(state?.textContent).toBe("Waiting for your answer");
    expect(stateBox?.right).toBeLessThanOrEqual(box?.right ?? 0);
    expect(stateBox?.width).toBeGreaterThan(100);
    expect(link?.scrollWidth).toBeLessThanOrEqual(link?.clientWidth ?? 0);
    // One line: the title is cut, not wrapped.
    expect(box?.height).toBeLessThan(40);
  } finally {
    await page.viewport(viewport.width, viewport.height);
  }
});
