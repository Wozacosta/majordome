import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ServerRow } from "./servers.logic";
import { isServerWay, ownServerCommand, ownServerTargets, serverWayRows } from "./serverWays.logic";

const ways = (view: Parameters<typeof serverWayRows>[0]["view"], canManage = true) =>
  serverWayRows({ view, canManage }).map((row) => row.way);

describe("serverWayRows", () => {
  it("offers every way while no server holds the notes", () => {
    expect(ways("setup")).toEqual(["hosted", "rent", "own"]);
  });

  it("leaves renting out where this window cannot set a server up", () => {
    expect(ways("setup", false)).toEqual(["hosted", "own"]);
  });

  it("still offers a server that exists once the notes are on one", () => {
    expect(ways("ready")).toEqual(["own"]);
  });

  it("offers nothing while a move is being made or undone", () => {
    expect(ways("progress")).toEqual([]);
    expect(ways("removing")).toEqual([]);
  });
});

describe("isServerWay", () => {
  it("accepts the three ways and nothing else", () => {
    expect(isServerWay("own")).toBe(true);
    expect(isServerWay("manual")).toBe(false);
    expect(isServerWay(undefined)).toBe(false);
  });
});

describe("ownServerCommand", () => {
  it("carries the owner's time zone", () => {
    expect(ownServerCommand("Europe/Paris")).toBe(
      "curl -fsSL https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy/install.sh | TZ=Europe/Paris sh",
    );
  });

  it("leaves out a zone that could not sit in a command", () => {
    expect(ownServerCommand("Europe/Paris; rm -rf /")).toMatch(/install\.sh \| sh$/);
    expect(ownServerCommand(undefined)).toMatch(/install\.sh \| sh$/);
  });
});

describe("ownServerTargets", () => {
  const row = (name: string, patch: Partial<ServerRow> = {}): ServerRow => ({
    environmentId: EnvironmentId.make(name),
    name,
    address: null,
    hosted: false,
    connection: "connected",
    hasNotes: false,
    runsRoutines: false,
    signedIn: true,
    isThisWindow: false,
    ...patch,
  });

  it("keeps the owner's own connected servers", () => {
    expect(
      ownServerTargets([
        row("Your server"),
        row("Majordome server", { hosted: true }),
        row("Asleep", { connection: "disconnected" }),
        row("Here", { isThisWindow: true }),
      ]).map((server) => server.name),
    ).toEqual(["Your server"]);
  });
});
