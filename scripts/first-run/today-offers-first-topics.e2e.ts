import { expect } from "e2e";

import { test } from "./first-run.ts";

// Run with FIRST_RUN_REPLAY=1: a topic's chat needs an assistant to start.
test("Today offers the ready-made topics until the notes have their first one", async ({
  firstRun,
  app,
  screen,
}) => {
  await firstRun.open();
  await expect(screen.getByText("Welcome to Majordome")).toBeVisible({ timeout: 60_000 });
  await screen.getByLabel("What should I call you?").fill("Ana Costa");
  await screen.getByRole("button", "Start new notes").tap();

  const offer = screen.getByRole("region", "Start a topic");
  await expect(offer).toBeVisible({ timeout: 60_000 });
  await app.screenshot("today-offers-topics");

  // One click picks it; the dialog only asks to confirm.
  await offer.getByRole("button", "Health").tap();
  await expect(screen.getByLabel("Name")).toHaveValue("Health");
  await app.screenshot("topic-picked");
  await screen.getByRole("button", "Add topic").tap();

  // The topic's chat opens, and Today stops offering.
  await expect(screen.getByText("What this chat knows")).toBeVisible({ timeout: 60_000 });
  expect(await firstRun.note(".majordome/topics.json")).toContain('"Health"');
  await screen.getByRole("link", "Today").tap();
  await expect(screen.getByPlaceholder("Ask anything", { exact: false })).toBeVisible();
  await expect(offer).toBeHidden();
  await app.screenshot("today-after-first-topic");
});
