import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ServerRow } from "./servers.logic";
import { serversMap } from "./serversMap.logic";

const mac = EnvironmentId.make("mac");
const own = EnvironmentId.make("own");
const hosted = EnvironmentId.make("hosted");

const server = (
  patch: Partial<ServerRow> & Pick<ServerRow, "environmentId" | "name">,
): ServerRow => ({
  address: null,
  hosted: false,
  connection: "connected",
  hasNotes: true,
  runsRoutines: false,
  signedIn: true,
  isThisWindow: false,
  ...patch,
});

describe("serversMap", () => {
  it("draws this Mac to every server, the phone to the one it opens, and marks the main one", () => {
    const map = serversMap({
      thisDevice: { name: "This Mac", environmentId: mac },
      servers: [
        server({
          environmentId: hosted,
          name: "Majordome server",
          hosted: true,
          runsRoutines: true,
        }),
        server({ environmentId: own, name: "Your server", connection: "disconnected" }),
      ],
      mainId: hosted,
      phone: { environmentId: hosted, computerName: "Majordome server", deviceName: "iPhone" },
    });
    expect(map.devices.map((node) => [node.title, node.detail])).toEqual([
      ["This Mac", "Where you are now"],
      ["iPhone", "Opens your Majordome server"],
    ]);
    expect(map.servers.map((node) => [node.title, node.kind, node.detail, node.main])).toEqual([
      ["Majordome server", "hosted", "Notes and routines", true],
      ["Your server", "server", "Can't be reached", false],
    ]);
    expect(map.lines).toEqual([
      { from: "this-device", to: hosted, live: true },
      { from: "this-device", to: own, live: false },
      { from: "phone", to: hosted, live: true },
    ]);
    expect(map.summary).toContain("Majordome server is the main one.");
  });

  it("gives a phone set up on this Mac, or not set up at all, words instead of a line", () => {
    const base = {
      thisDevice: { name: "This Mac", environmentId: mac },
      servers: [server({ environmentId: own, name: "Your server" })],
      mainId: mac,
    };
    const onMac = serversMap({
      ...base,
      phone: { environmentId: mac, computerName: "This Mac", deviceName: "iPhone" },
    });
    expect(onMac.devices.map((node) => [node.detail, node.main])).toEqual([
      ["Where you are now", true],
      ["Opens this Mac", false],
    ]);
    expect(onMac.lines).toHaveLength(1);
    const none = serversMap({
      ...base,
      phone: { environmentId: own, computerName: "Your server", deviceName: null },
    });
    expect(none.devices[1]).toMatchObject({ detail: "Not set up yet", faint: true });
    expect(none.lines).toHaveLength(1);
  });

  it("in a browser, draws the window to the one server it was opened from", () => {
    const map = serversMap({
      thisDevice: { name: "This browser", environmentId: null },
      servers: [
        server({ environmentId: own, name: "Your server", isThisWindow: true }),
        server({ environmentId: hosted, name: "Majordome server", hosted: true }),
      ],
      mainId: own,
      phone: null,
    });
    expect(map.devices).toMatchObject([{ detail: "Opens your server", main: false }]);
    expect(map.lines).toEqual([{ from: "this-device", to: own, live: true }]);
  });
});
