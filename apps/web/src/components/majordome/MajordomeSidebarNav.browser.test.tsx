import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import type { AttentionCard } from "./attention.logic";
import { MajordomeSidebarAlert, MajordomeSidebarNav } from "./MajordomeSidebarNav";

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
  // The test browser is phone-width, where the menu starts as icons.
  localStorage.setItem("majordome:sidebar-menu-compact", "false");
}

const navLinks = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Majordome"] a')].map(
    (link) => [link.textContent, link.getAttribute("href")],
  );

it("lists only Majordome's own screens", async () => {
  setup(null);
  await using screen = await render(
    <SidebarProvider>
      <MajordomeSidebarNav />
    </SidebarProvider>,
  );
  expect(navLinks(screen.container)).toEqual([
    ["Today", "/"],
    ["Notes", "/notes"],
    ["To-dos", "/todos"],
    ["Reading list", "/reading"],
    ["Routines", "/routines"],
    ["Reminders", "/reminders"],
    ["What it did", "/feed"],
  ]);

  await screen.getByRole("button", { name: "Show the menu as icons" }).click();
  await expect.element(screen.getByRole("link", { name: "What it did" })).toBeVisible();
  expect(navLinks(screen.container)).toEqual([
    ["", "/"],
    ["", "/notes"],
    ["", "/todos"],
    ["", "/reading"],
    ["", "/routines"],
    ["", "/reminders"],
    ["", "/feed"],
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
