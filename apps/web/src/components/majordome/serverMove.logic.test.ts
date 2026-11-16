import {
  EnvironmentId,
  type MajordomeServerMove,
  type MajordomeServerMoveCheck,
  type MajordomeServerMoveStatus,
  ProjectId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canStartServerMove,
  chosenLocation,
  formatMonthlyPrice,
  hasReadyProvider,
  locationLabel,
  problemsFor,
  serverMoveNextStep,
  serverMoveStepRows,
  serverMoveView,
  serverSummary,
} from "./serverMove.logic";

const move = (patch: Partial<MajordomeServerMove> = {}): MajordomeServerMove => ({
  id: "move-1",
  projectId: ProjectId.make("vault"),
  startedAt: "2026-11-16T10:00:00.000Z",
  phase: "running",
  steps: [
    { id: "check", state: "done" },
    { id: "key", state: "done" },
    { id: "server", state: "working" },
    { id: "start", state: "pending" },
    { id: "pair", state: "pending" },
    { id: "notes", state: "pending" },
  ],
  server: null,
  routinesOnServer: false,
  ...patch,
});

const status = (patch: Partial<MajordomeServerMoveStatus> = {}): MajordomeServerMoveStatus => ({
  keys: { hetzner: true, tailscale: true },
  move: null,
  removal: null,
  ...patch,
});

const check = (patch: Partial<MajordomeServerMoveCheck> = {}): MajordomeServerMoveCheck => ({
  problems: [],
  notices: [],
  locations: [
    { name: "fsn1", city: "Falkenstein", country: "DE", serverType: "cx23", monthlyPrice: "4.75" },
    { name: "ash", city: "Ashburn, VA", country: "US", serverType: "cpx22", monthlyPrice: "8.32" },
  ],
  defaultLocation: "fsn1",
  currency: "EUR",
  ...patch,
});

describe("serverMoveView", () => {
  it("follows the server's phase", () => {
    expect(serverMoveView(status())).toBe("setup");
    expect(serverMoveView(status({ move: move() }))).toBe("progress");
    expect(serverMoveView(status({ move: move({ phase: "failed" }) }))).toBe("progress");
    expect(serverMoveView(status({ move: move({ phase: "ready" }) }))).toBe("ready");
    expect(serverMoveView(status({ move: move({ phase: "removing" }) }))).toBe("removing");
  });
});

describe("serverMoveStepRows", () => {
  it("labels each step and carries only a failed step's reason", () => {
    const rows = serverMoveStepRows(
      move({
        steps: [
          { id: "check", state: "done" },
          { id: "key", state: "failed", problem: "Tailscale does not accept this secret." },
          { id: "server", state: "pending", problem: "left over from an earlier try" },
          { id: "start", state: "working" },
          { id: "pair", state: "failed" },
          { id: "notes", state: "pending" },
        ],
      }),
    );
    expect(rows.map((row) => [row.label, row.tone, row.stateLabel, row.problem])).toEqual([
      ["Check everything is ready", "ok", "Done", null],
      [
        "Let the new server join your private network",
        "error",
        "Failed",
        "Tailscale does not accept this secret.",
      ],
      ["Create the server at Hetzner", "neutral", "Not started", null],
      ["Wait for Majordome to start on it", "neutral", "In progress", null],
      ["Connect this computer to it", "error", "Failed", "This step did not finish."],
      ["Copy your notes over", "neutral", "Not started", null],
    ]);
  });
});

describe("prices and locations", () => {
  it("writes the price in the account's currency, or as given when it has none", () => {
    expect(formatMonthlyPrice("4.75", "EUR", "en-US")).toBe("€4.75");
    expect(formatMonthlyPrice("4.75", "USD", "en-US")).toBe("$4.75");
    expect(formatMonthlyPrice("4.75", null, "en-US")).toBe("4.75");
    expect(formatMonthlyPrice("4.75", "not-a-currency", "en-US")).toBe("4.75 not-a-currency");
  });

  it("names a location by its city and country with the monthly price", () => {
    const [falkenstein, ashburn] = check().locations;
    expect(locationLabel(falkenstein!, "EUR", "en-US")).toBe(
      "Falkenstein, Germany · €4.75 a month",
    );
    expect(locationLabel(ashburn!, "EUR", "en-US")).toBe("Ashburn, United States · €8.32 a month");
  });

  it("starts from the default and keeps the owner's pick while it is on offer", () => {
    expect(chosenLocation(null, "ash")).toBeNull();
    expect(chosenLocation(check(), null)?.name).toBe("fsn1");
    expect(chosenLocation(check(), "ash")?.name).toBe("ash");
    expect(chosenLocation(check(), "gone")?.name).toBe("fsn1");
    expect(chosenLocation(check({ defaultLocation: null }), null)?.name).toBe("fsn1");
    expect(chosenLocation(check({ locations: [] }), null)).toBeNull();
  });
});

describe("problemsFor", () => {
  it("puts each problem under the key it is about", () => {
    const found = check({
      problems: [
        { area: "hetzner", message: "This Hetzner key can only read." },
        { area: "tailscale", message: "HTTPS is off." },
        { area: "notes", message: "Your notes have no saved history yet." },
        { area: "this-computer", message: "Tailscale is not signed in." },
      ],
    });
    expect(problemsFor(found, "hetzner")).toEqual(["This Hetzner key can only read."]);
    expect(problemsFor(found, "tailscale")).toEqual(["HTTPS is off."]);
    expect(problemsFor(found, "other")).toEqual([
      "Your notes have no saved history yet.",
      "Tailscale is not signed in.",
    ]);
    expect(problemsFor(null, "hetzner")).toEqual([]);
  });
});

describe("canStartServerMove", () => {
  const projectId = "vault";
  it("needs both keys, a clean check, a location, notes, and no server already", () => {
    expect(canStartServerMove({ status: status(), check: check(), projectId })).toBe(true);
    expect(canStartServerMove({ status: status(), check: null, projectId })).toBe(false);
    expect(canStartServerMove({ status: status(), check: check(), projectId: null })).toBe(false);
    expect(
      canStartServerMove({
        status: status({ keys: { hetzner: true, tailscale: false } }),
        check: check(),
        projectId,
      }),
    ).toBe(false);
    expect(
      canStartServerMove({
        status: status(),
        check: check({ problems: [{ area: "notes", message: "no history" }] }),
        projectId,
      }),
    ).toBe(false);
    expect(
      canStartServerMove({ status: status(), check: check({ locations: [] }), projectId }),
    ).toBe(false);
    expect(
      canStartServerMove({
        status: status({ move: move({ phase: "ready" }) }),
        check: check(),
        projectId,
      }),
    ).toBe(false);
  });
});

describe("after the server is up", () => {
  const provider = (patch: Partial<ServerProvider>): ServerProvider =>
    ({
      enabled: true,
      installed: true,
      status: "ready",
      availability: "available",
      ...patch,
    }) as ServerProvider;

  it("counts a provider only when it is on, installed and signed in", () => {
    expect(hasReadyProvider(undefined)).toBe(false);
    expect(hasReadyProvider([provider({ status: "error" })])).toBe(false);
    expect(hasReadyProvider([provider({ enabled: false })])).toBe(false);
    expect(hasReadyProvider([provider({ availability: "unavailable" })])).toBe(false);
    expect(hasReadyProvider([provider({ status: "error" }), provider({})])).toBe(true);
  });

  it("asks for the next thing in order: add it here, sign in, then move routines", () => {
    const ready = move({ phase: "ready" });
    expect(serverMoveNextStep({ move: ready, saved: false, providerReady: false })).toBe(
      "add-to-app",
    );
    expect(serverMoveNextStep({ move: ready, saved: true, providerReady: false })).toBe("sign-in");
    expect(serverMoveNextStep({ move: ready, saved: true, providerReady: true })).toBe(
      "move-routines",
    );
    expect(
      serverMoveNextStep({
        move: move({ phase: "ready", routinesOnServer: true }),
        saved: false,
        providerReady: false,
      }),
    ).toBe("done");
  });

  it("sums the server up with what Hetzner bills for it", () => {
    const server = {
      name: "majordome",
      location: "fsn1",
      serverType: "cx23",
      monthlyPrice: "4.75",
      currency: "EUR",
      url: "https://majordome.tail1234.ts.net",
      environmentId: EnvironmentId.make("env-server"),
    };
    expect(serverSummary(move(), "en-US")).toBeNull();
    expect(serverSummary(move({ server }), "en-US")).toBe(
      "majordome (cx23, fsn1) · €4.75 a month, billed by Hetzner",
    );
    expect(serverSummary(move({ server: { ...server, monthlyPrice: null } }), "en-US")).toBe(
      "majordome (cx23, fsn1)",
    );
  });
});
