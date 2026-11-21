import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

vi.mock("~/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/env")>()),
  isMajordome: true,
}));

vi.mock("./useAvailableSettingsSearchItems", () => ({ useAvailableSettingsSearchItems: () => [] }));

function renderNav(pathname: string) {
  return render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname={pathname} />
    </SidebarProvider>,
    { router: pathname },
  );
}

const sections = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-settings-section]")].map((row) =>
    row.getAttribute("data-settings-section"),
  );

it("folds Advanced away until opened, and remembers it was opened", async () => {
  localStorage.clear();
  {
    await using screen = await renderNav("/settings/general");
    const advanced = page.getByRole("button", { name: "Advanced" });
    await expect.element(advanced).toHaveAttribute("aria-expanded", "false");
    expect(sections(screen.container)).not.toContain("/settings/keybindings");
    expect(sections(screen.container)).toContain("/settings/backup");

    await userEvent.click(advanced);
    await expect.element(advanced).toHaveAttribute("aria-expanded", "true");
    expect(sections(screen.container)).toContain("/settings/keybindings");
  }
  await using screen = await renderNav("/settings/general");
  await expect
    .element(page.getByRole("button", { name: "Advanced" }))
    .toHaveAttribute("aria-expanded", "true");
  expect(sections(screen.container)).toContain("/settings/keybindings");
  localStorage.clear();
});

it("keeps the open Advanced page in view while the group is folded", async () => {
  localStorage.clear();
  await using screen = await renderNav("/settings/keybindings");
  await expect
    .element(page.getByRole("button", { name: "Advanced" }))
    .toHaveAttribute("aria-expanded", "false");
  const last = sections(screen.container).slice(-3);
  expect(last).toEqual(["/settings/keybindings", "/settings/about", "/settings/archived"]);
});
