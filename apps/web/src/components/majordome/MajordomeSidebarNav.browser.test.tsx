import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import type { AttentionCard } from "./attention.logic";
import { MajordomePageRail, MajordomeSidebarAlert } from "./MajordomeSidebarNav";

const state = vi.hoisted(() => ({ attention: null as AttentionCard | null }));
vi.mock("./useAttention", () => ({ useAttention: () => state.attention }));
vi.mock("./NewChatRow", () => ({ NewChatRow: () => null }));
vi.mock("./useMajordomeVaults", () => ({
  useMajordomeVaults: () => ({ activeVault: {}, loading: false }),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => [],
  useQuietThreadShells: () => [],
}));

function setup(attention: AttentionCard | null) {
  state.attention = attention;
  localStorage.removeItem("majordome:sidebar-pinned-pages");
}

const rail = (
  <SidebarProvider>
    <MajordomePageRail footer={null} />
  </SidebarProvider>
);

const railLinks = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Majordome"] a')].map(
    (link) => [link.getAttribute("aria-label"), link.getAttribute("href")],
  );

it("keeps the pinned pages in the rail and every page under More", async () => {
  setup(null);
  {
    await using screen = await render(rail, { router: "/reminders" });
    expect(railLinks(screen.container)).toEqual([
      ["Today", "/"],
      ["Notes", "/notes"],
      ["To-dos", "/todos"],
      ["Reading list", "/reading"],
      ["Routines", "/routines"],
    ]);
    // The open page is not pinned, so More is what shows it.
    const more = screen.getByRole("button", { name: "More" });
    await expect.element(more).toHaveAttribute("data-active", "true");

    await more.click();
    await expect
      .element(page.getByRole("link", { name: "What it did" }))
      .toHaveAttribute("href", "/feed");
    await page.getByRole("button", { name: "Pin Reminders" }).click();
    await page.getByRole("button", { name: "Unpin Reading list" }).click();
    await expect.element(page.getByRole("button", { name: "Pin Reading list" })).toBeVisible();
    expect(railLinks(screen.container)).toEqual([
      ["Today", "/"],
      ["Notes", "/notes"],
      ["To-dos", "/todos"],
      ["Routines", "/routines"],
      ["Reminders", "/reminders"],
    ]);
    await expect.element(more).toHaveAttribute("data-active", "false");
    // Unpinned, the page is still one click away.
    await expect
      .element(page.getByRole("link", { name: "Reading list" }))
      .toHaveAttribute("href", "/reading");
  }

  // A restart reads the same choice back.
  await using restarted = await render(rail);
  expect(railLinks(restarted.container)).toEqual([
    ["Today", "/"],
    ["Notes", "/notes"],
    ["To-dos", "/todos"],
    ["Routines", "/routines"],
    ["Reminders", "/reminders"],
  ]);
});

it("shows no card at the foot of the sidebar while nothing needs the owner", async () => {
  setup(null);
  await using screen = await render(
    <SidebarProvider>
      <MajordomeSidebarAlert />
    </SidebarProvider>,
  );
  expect(screen.container.querySelector("[data-attention]")).toBeNull();
});

it("says at the foot of the sidebar what needs the owner, leading to where it is fixed", async () => {
  setup({
    text: "Backup paused",
    tone: "warning",
    link: { to: "/settings/backup" },
    count: 1,
    action: "Fix",
  });
  await using screen = await render(
    <SidebarProvider>
      <MajordomeSidebarAlert />
    </SidebarProvider>,
  );
  const alert = screen.container.querySelector<HTMLAnchorElement>("[data-attention]");
  expect(alert?.getAttribute("href")).toBe("/settings/backup");
  expect(alert?.getAttribute("data-attention")).toBe("warning");
  expect(alert?.querySelector('[role="status"]')?.textContent).toBe("Backup paused");
  expect(alert?.textContent).toContain("Fix");
});
