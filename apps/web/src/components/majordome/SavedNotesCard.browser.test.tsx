import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { SavedNotesCard } from "./SavedNotesCard";

const card = (files: ReadonlyArray<string>) => (
  <SavedNotesCard
    files={files}
    projectId={ProjectId.make("project")}
    environmentId={EnvironmentId.make("env")}
    onSeeChanges={() => {}}
  />
);

it("keeps the saved notes to one line until asked for them", async () => {
  await using screen = await render(card(["me.md", "memory.md", "trips/paris.md"]));

  const summary = screen.getByRole("button", { name: "Saved to your notes 3 notes" });
  await expect.element(summary).toBeVisible();
  expect(screen.getByRole("link", { name: "paris" }).query()).toBeNull();

  await summary.click();
  await expect.element(screen.getByRole("link", { name: "paris" })).toBeVisible();
  await expect.element(screen.getByText("in Trips")).toBeVisible();

  await summary.click();
  await expect.poll(() => screen.getByRole("link", { name: "paris" }).query()).toBeNull();
});

it("names the note when only one was saved", async () => {
  await using screen = await render(card(["trips/paris.md"]));

  await expect
    .element(screen.getByRole("button", { name: "Saved to your notes paris" }))
    .toBeVisible();
});
