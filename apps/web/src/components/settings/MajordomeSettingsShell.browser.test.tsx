import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { MajordomeSettingsShell } from "./MajordomeSettingsShell";

vi.mock("~/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/env")>()),
  isMajordome: true,
}));

vi.mock("./useAvailableSettingsSearchItems", () => ({ useAvailableSettingsSearchItems: () => [] }));
// The close button needs the Settings dialog around it, and the dialog needs the app stylesheet.
vi.mock("../AppRouteModal", () => ({ AppRouteModalClose: () => null }));

async function setViewport(width: number, height: number): Promise<AsyncDisposable> {
  const previous = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, height);
  return { [Symbol.asyncDispose]: () => page.viewport(previous.width, previous.height) };
}

function renderSettings(pathname: string) {
  return render(
    <SidebarProvider defaultOpen>
      <MajordomeSettingsShell>
        <p>The open page</p>
      </MajordomeSettingsShell>
    </SidebarProvider>,
    { router: pathname },
  );
}

const pathnameOf = (screen: Awaited<ReturnType<typeof renderSettings>>) =>
  screen.router?.state.location.pathname;

it("drills from the list of pages into a page and back on a phone", async () => {
  await using _viewport = await setViewport(390, 800);
  await using screen = await renderSettings("/settings");

  const backup = page.getByRole("button", { name: "Back up my brain" });
  const back = page.getByRole("button", { name: "Settings", exact: true });
  await expect.element(backup).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Your notes" })).toBeVisible();
  await expect.element(page.getByRole("combobox", { name: "Search settings" })).toBeVisible();
  await expect.element(page.getByText("The open page")).not.toBeInTheDocument();
  await expect.element(back).not.toBeInTheDocument();

  await userEvent.click(backup);
  await expect.element(page.getByText("The open page")).toBeVisible();
  expect(pathnameOf(screen)).toBe("/settings/backup");
  await expect.element(backup).not.toBeInTheDocument();

  await userEvent.click(back);
  await expect.element(backup).toBeVisible();
  expect(pathnameOf(screen)).toBe("/settings");
  await expect.element(page.getByText("The open page")).not.toBeInTheDocument();
});

it("opens a deep link on its page on a phone, with the way back to the list", async () => {
  await using _viewport = await setViewport(390, 800);
  await using _screen = await renderSettings("/settings/phone");

  await expect.element(page.getByText("The open page")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect.element(page.getByRole("navigation")).not.toBeInTheDocument();
});

it("keeps the list beside the page on a wide screen, and opens Status from /settings", async () => {
  await using _viewport = await setViewport(1280, 800);
  await using screen = await renderSettings("/settings");

  await expect.element(page.getByText("The open page")).toBeVisible();
  expect(pathnameOf(screen)).toBe("/settings/overview");
  await expect
    .element(page.getByRole("button", { name: "Status" }))
    .toHaveAttribute("aria-current", "page");
  await expect
    .element(page.getByRole("button", { name: "Settings", exact: true }))
    .not.toBeInTheDocument();
});
