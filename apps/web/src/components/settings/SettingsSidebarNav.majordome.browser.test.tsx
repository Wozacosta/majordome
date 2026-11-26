import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

vi.mock("~/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/env")>()),
  isMajordome: true,
}));

vi.mock("./useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [],
  useHasSecretProvidersEnvironment: () => false,
}));

function renderNav(pathname: string) {
  return render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname={pathname} />
    </SidebarProvider>,
    { router: pathname },
  );
}

const sections = (container: HTMLElement) =>
  // A folded part's rows stay in the page at no height, inert.
  [...container.querySelectorAll("[data-settings-section]")]
    .filter((row) => row.closest("[inert]") === null)
    .map((row) => row.getAttribute("data-settings-section"));

const PARTS = ["This app", "Notes", "Files & credentials", "AI", "You and your devices", "Others"];

it("shows the six parts and no page until a part is opened, and remembers what was opened", async () => {
  localStorage.clear();
  {
    await using screen = await renderNav("/settings/guide/app");
    for (const part of PARTS) {
      await expect.element(page.getByRole("button", { name: part, exact: true })).toBeVisible();
    }
    expect(sections(screen.container).filter((id) => id?.startsWith("/settings/"))).toEqual([
      "/settings/guide/app",
      "/settings/guide/notes",
      "/settings/guide/ai",
      "/settings/guide/devices",
    ]);

    const show = page.getByRole("button", { name: "Show the pages of Notes" });
    await expect.element(show).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(show);
    await expect
      .element(page.getByRole("button", { name: "Hide the pages of Notes" }))
      .toHaveAttribute("aria-expanded", "true");
    expect(sections(screen.container)).toContain("/settings/backup");
  }
  await using screen = await renderNav("/settings/guide/app");
  expect(sections(screen.container)).toContain("/settings/backup");
  localStorage.clear();
});

it("opens a part's own page from its name, and unfolds its pages beside it", async () => {
  localStorage.clear();
  await using screen = await renderNav("/settings/overview");
  await userEvent.click(page.getByRole("button", { name: "AI", exact: true }));
  await expect.poll(() => screen.router?.state.location.pathname).toBe("/settings/guide/ai");
  expect(sections(screen.container)).toContain("/settings/providers");
  localStorage.clear();
});

it("a part without a page of its own only folds and unfolds", async () => {
  localStorage.clear();
  await using screen = await renderNav("/settings/guide/app");
  const others = page.getByRole("button", { name: "Others", exact: true });
  await expect.element(others).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(others);
  await expect.element(others).toHaveAttribute("aria-expanded", "true");
  expect(sections(screen.container)).toContain("/settings/labs");
  expect(screen.router?.state.location.pathname).toBe("/settings/guide/app");
  localStorage.clear();
});

it("keeps the open page in view while its part is folded", async () => {
  localStorage.clear();
  await using screen = await renderNav("/settings/keybindings");
  expect(sections(screen.container).filter((id) => id?.startsWith("/settings/"))).toEqual([
    "/settings/guide/app",
    "/settings/keybindings",
    "/settings/guide/notes",
    "/settings/guide/ai",
    "/settings/guide/devices",
  ]);
});
