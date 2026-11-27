import { expect } from "e2e";

import { startSecondServer } from "./second-server.ts";
import { test, WEB } from "./t3.ts";

test(
  "Your servers offers three ways to add a server, each on its own page, and installs on one you already have with one command",
  WEB,
  async ({ t3, app, screen }) => {
    await t3.open("/settings/always-on");
    await expect(screen.getByRole("heading", "Your servers", { level: 1 })).toBeVisible();
    // The page lists the ways in one line each; how each is done is a page away.
    const hosted = screen.getByRole("link", "Let Majordome host it", { exact: false });
    const rent = screen.getByRole("link", "Rent one for me", { exact: false });
    const own = screen.getByRole("link", "Use a server I already have", { exact: false });
    await expect(hosted).toBeVisible();
    await expect(rent).toBeVisible();
    await expect(own).toBeVisible();
    await expect(screen.getByText("Hetzner key", { exact: false })).toBeHidden();
    await app.screenshot("add-a-server-three-ways");

    await rent.tap();
    await expect(screen.getByRole("heading", "Rent a server", { level: 1 })).toBeVisible();
    await expect(screen.getByText("1. Hetzner key")).toBeVisible();
    // Each company it names is a link to that company.
    await expect(screen.getByRole("link", "Tailscale", { exact: true })).toHaveAttribute(
      "href",
      "https://tailscale.com",
    );
    await expect(screen.getByRole("link", "Hetzner", { exact: true })).toHaveAttribute(
      "href",
      "https://www.hetzner.com/cloud",
    );
    await app.screenshot("add-a-server-rent");
    await screen.getByRole("link", "Your servers").tap();

    await hosted.tap();
    await expect(screen.getByRole("heading", "Let Majordome host it", { level: 1 })).toBeVisible();
    await expect(screen.getByRole("link", "majord.me/start")).toBeVisible();
    await screen.getByRole("link", "Your servers").tap();

    await own.tap();
    await expect(
      screen.getByRole("heading", "A server you already have", { level: 1 }),
    ).toBeVisible();
    await expect(
      screen.getByText("deploy/install.sh | TZ=", { exact: false }).first(),
    ).toBeVisible();
    await app.screenshot("add-a-server-own");

    // The link the command ends with adds the server from this same page.
    const server = startSecondServer(app.baseUrl ?? "");
    try {
      const { host, token } = await server.ready;
      await screen.getByRole("button", "Add a computer").tap();
      const dialog = screen.getByRole("dialog");
      await dialog.getByPlaceholder("backend.example.com").fill(host);
      await dialog.getByPlaceholder("PAIRCODE").fill(token);
      await dialog.getByRole("button", "Add a computer").tap();
      await expect(screen.getByText("Scenario is in this app.")).toBeVisible({ timeout: 60_000 });
      await expect(screen.getByRole("button", "Move my notes to Scenario")).toBeVisible();
      await app.screenshot("add-a-server-own-added");

      await screen.getByRole("link", "Your servers").tap();
      const remove = screen.getByRole("button", "Remove Scenario from this app");
      await remove.tap();
      await screen.getByRole("alertdialog").getByRole("button", "Remove from this app").tap();
      await expect(remove).toBeHidden({ timeout: 30_000 });
    } finally {
      await server.stop();
    }
  },
);
