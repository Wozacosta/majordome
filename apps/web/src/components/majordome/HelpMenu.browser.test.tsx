import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { APP_VERSION } from "../../branding";
import { SidebarMenu, SidebarProvider } from "../ui/sidebar";
import { WhatsNewHost } from "../WhatsNew";
import { HelpMenu } from "./HelpMenu";

const LAST_LAUNCHED = "majordome:whats-new:last-seen-version";
const NOTES_SEEN = "majordome:whats-new:notes-seen-version";

it("marks unread notes after an update, and reports a problem with the version alone", async () => {
  localStorage.setItem(LAST_LAUNCHED, JSON.stringify("0.0.1"));
  localStorage.removeItem(NOTES_SEEN);
  const opened = vi.spyOn(window, "open").mockReturnValue(null);

  await using screen = await render(
    <SidebarProvider>
      <SidebarMenu>
        <HelpMenu side="right" />
      </SidebarMenu>
      <WhatsNewHost />
    </SidebarProvider>,
  );
  const help = screen.getByRole("button", { name: "Help, new version" });
  await expect.element(help).toBeVisible();
  expect(screen.container.querySelector("[data-unseen-notes]")).not.toBeNull();

  await help.click();
  await page.getByRole("menuitem", { name: "Report a problem" }).click();
  const reported = new URL(String(opened.mock.calls[0]?.[0]));
  expect(reported.pathname).toBe("/Wozacosta/majordome/issues/new");
  expect([...reported.searchParams.keys()]).toEqual(["template", "version", "environment"]);
  expect(reported.searchParams.get("version")).toBe(APP_VERSION);

  await help.click();
  await page.getByRole("menuitem", { name: "Guides" }).click();
  expect(opened.mock.calls[1]?.[0]).toBe(
    "https://github.com/Wozacosta/majordome/tree/main/docs/user",
  );

  await help.click();
  await page.getByRole("menuitem", { name: "What's new" }).click();
  await expect.element(page.getByRole("dialog").getByText("Try this").first()).toBeVisible();
  // The open notes hide the rest of the page from roles, so the button is read from the page.
  expect(screen.container.querySelector("button")?.getAttribute("aria-label")).toBe("Help");
  expect(screen.container.querySelector("[data-unseen-notes]")).toBeNull();
  expect(localStorage.getItem(NOTES_SEEN)).toBe(JSON.stringify(APP_VERSION));
});
