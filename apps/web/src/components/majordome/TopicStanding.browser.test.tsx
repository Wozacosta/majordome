import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { TopicStanding } from "./TopicStanding";

const environmentId = EnvironmentId.make("env");
const threadId = ThreadId.make("thread-taxes");

const state = vi.hoisted(() => ({
  standing: null as { text: string; updatedAt?: string } | null | undefined,
}));

vi.mock("./useMajordomeVaults", () => ({
  useMajordomeVaults: () => ({
    copies: [
      {
        environmentId: "env",
        projectId: "project",
        topics: [
          {
            id: "taxes",
            title: "Taxes",
            folder: "Topics/Taxes",
            threadId: "thread-taxes",
            folderExists: true,
            keyNote: "Topics/Taxes/log.md",
            standing: state.standing,
          },
        ],
      },
    ],
  }),
}));

async function setup(standing: typeof state.standing, width = 1024) {
  state.standing = standing;
  localStorage.removeItem("majordome:topic-standing-collapsed");
  await page.viewport(width, 768);
}

const strip = <TopicStanding environmentId={environmentId} threadId={threadId} />;

it("shows nothing until the assistant has written where things stand", async () => {
  await setup(null);
  await using screen = await render(strip);
  expect(screen.container.querySelector("[data-topic-standing]")).toBeNull();
});

it("folds to one line, opens the log in Notes, and remembers the fold for the topic", async () => {
  await setup({ text: "Waiting on the notary.\nNext: sign on Friday." });
  {
    await using screen = await render(strip);
    await expect.element(screen.getByText(/Next: sign on Friday\./)).toBeVisible();
    await expect.element(screen.getByText("Where things stand", { exact: true })).toBeVisible();
    const log = screen.getByRole("link", { name: "Open the log" });
    await expect.element(log).toHaveAttribute("href", expect.stringContaining("/notes?"));
    await expect.element(log).toHaveAttribute("href", expect.stringContaining("log.md"));

    const open = screen.container.querySelector<HTMLElement>("[data-topic-standing]");
    const openHeight = open?.getBoundingClientRect().height ?? 0;
    await userEvent.click(screen.getByRole("button", { name: "Show less" }));
    const line = screen.getByText("Waiting on the notary.", { exact: true });
    await expect.element(line).toBeVisible();
    expect(screen.container.textContent).not.toContain("Next: sign on Friday.");
    expect(open?.getBoundingClientRect().height).toBeLessThan(openHeight);
    // Folded, the label shares the one row with the first line.
    const label = screen.getByText("Where things stand", { exact: true });
    await expect.element(label).toBeVisible();
    expect(label.element().getBoundingClientRect().right).toBeLessThanOrEqual(
      line.element().getBoundingClientRect().left,
    );
    expect(open?.getBoundingClientRect().height).toBeLessThan(48);
  }
  await using again = await render(
    <TopicStanding environmentId={environmentId} threadId={threadId} />,
  );
  await expect
    .element(again.getByRole("button", { name: "Show where things stand" }))
    .toBeVisible();
  expect(again.container.textContent).not.toContain("Next: sign on Friday.");
});

it("starts folded in a narrow window", async () => {
  await setup({ text: "Waiting on the notary.\nNext: sign on Friday." }, 390);
  await using screen = await render(strip);
  await expect
    .element(screen.getByRole("button", { name: "Show where things stand" }))
    .toBeVisible();
  // Too little room beside the line: the label sits above it.
  const label = screen.getByText("Where things stand", { exact: true });
  await expect.element(label).toBeVisible();
  expect(label.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
    screen.getByText("Waiting on the notary.", { exact: true }).element().getBoundingClientRect()
      .top,
  );
});
