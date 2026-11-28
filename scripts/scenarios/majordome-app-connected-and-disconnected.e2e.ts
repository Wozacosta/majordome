// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { expect } from "e2e";

import { T3_HOME } from "../e2e.config.ts";
import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

const STORE = NodePath.join(T3_HOME, "userdata", "majordome", "connections.json");

/** Granola as the server keeps it after a sign-in. The sign-in itself needs Granola's own site. */
const connected = {
  granola: {
    name: "Granola",
    server: {
      resource: "https://mcp.granola.ai/mcp",
      issuer: "https://mcp-auth.granola.ai",
      authorizationEndpoint: "https://mcp-auth.granola.ai/oauth2/authorize",
      tokenEndpoint: "https://mcp-auth.granola.ai/oauth2/token",
      registrationEndpoint: "https://mcp-auth.granola.ai/oauth2/register",
      revocationEndpoint: null,
      scope: "mcp offline_access",
      namesItselfInCallback: true,
    },
    clientId: "client-scenario",
    state: "connected",
    addedAt: "2026-11-28T00:00:00.000Z",
    routinesMayChange: false,
  },
};

const stored = () => JSON.parse(NodeFS.readFileSync(STORE, "utf8")) as typeof connected | {};

test(
  "An app can be connected from Connections; a connected one has its switch and is disconnected",
  WEB,
  async ({ t3, app, screen, browser }) => {
    NodeFS.rmSync(STORE, { force: true });
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open("/settings/connectors");
    const card = browser.locator('[data-connection="Granola"]');
    await expect(card.getByRole("button", "Connect")).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Meeting notes and transcripts")).toBeVisible();
    await expect(screen.getByRole("heading", "App catalog", { level: 2 })).toBeVisible();
    await expect(
      browser.locator('[data-connection="Notion"]').getByText("Pages and databases"),
    ).toBeVisible();
    await app.screenshot("app-to-connect");

    NodeFS.mkdirSync(NodePath.dirname(STORE), { recursive: true });
    NodeFS.writeFileSync(STORE, JSON.stringify(connected));
    await t3.open("/settings/connectors");
    await expect(card.getByRole("button", "Disconnect")).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Connected")).toBeVisible();
    await app.screenshot("app-connected");

    await card.getByRole("switch").check();
    await expect.poll(() => (stored() as typeof connected).granola?.routinesMayChange).toBe(true);

    await card.getByRole("button", "Disconnect").tap();
    await expect(card.getByRole("button", "Connect")).toBeVisible();
    expect(stored()).toEqual({});
  },
);
