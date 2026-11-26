import type { EnvironmentId } from "@t3tools/contracts";

import { machineInSentence } from "./brains.logic";
import type { ServerRow } from "./servers.logic";

export interface ServersMapNode {
  readonly id: string;
  readonly kind: "this-device" | "phone" | "server" | "hosted";
  readonly title: string;
  readonly detail: string | null;
  /** Where the assistant answers and the chats are kept. */
  readonly main: boolean;
  /** Not there yet, or out of reach: drawn faint. */
  readonly faint: boolean;
}

export interface ServersMapLine {
  readonly from: string;
  readonly to: string;
  readonly live: boolean;
}

export interface ServersMap {
  readonly devices: ReadonlyArray<ServersMapNode>;
  readonly servers: ReadonlyArray<ServersMapNode>;
  readonly lines: ReadonlyArray<ServersMapLine>;
  /** The whole drawing in a sentence, for a screen reader. */
  readonly summary: string;
}

const THIS_DEVICE = "this-device";
const PHONE = "phone";

/**
 * The drawing on "Your servers": the devices in the owner's hands on the left, the servers on the
 * right, and a line for each device that opens a server. A phone set up on this device has no
 * line: it says so in words instead.
 */
export function serversMap(input: {
  /**
   * "This Mac" with its own server's id in the desktop app, which reaches every server. In a
   * browser the id is null: the window only opens the server it was loaded from.
   */
  readonly thisDevice: { readonly name: string; readonly environmentId: EnvironmentId | null };
  readonly servers: ReadonlyArray<ServerRow>;
  /** Null until it is known. */
  readonly mainId: EnvironmentId | null;
  /** The computer a phone is set up on, and the phone that gets notifications from it, if any. */
  readonly phone: {
    readonly environmentId: EnvironmentId;
    readonly computerName: string;
    readonly deviceName: string | null;
  } | null;
}): ServersMap {
  const serverNodes = input.servers.map((server): ServersMapNode => ({
    id: server.environmentId,
    kind: server.hosted ? "hosted" : "server",
    title: server.name,
    detail:
      server.connection === "connected"
        ? server.hasNotes === true
          ? server.runsRoutines
            ? "Notes and routines"
            : "A copy of your notes"
          : server.hasNotes === false
            ? "None of your notes"
            : null
        : server.connection === "connecting"
          ? "Connecting…"
          : "Can't be reached",
    main: server.environmentId === input.mainId,
    faint: server.connection !== "connected",
  }));
  const devices: Array<ServersMapNode> = [];
  const lines: Array<ServersMapLine> = [];
  const { thisDevice } = input;
  const opened = input.servers.find((server) => server.isThisWindow);
  devices.push({
    id: THIS_DEVICE,
    kind: "this-device",
    title: thisDevice.name,
    detail:
      thisDevice.environmentId === null && opened !== undefined
        ? `Opens ${machineInSentence(opened.name)}`
        : "Where you are now",
    main: thisDevice.environmentId !== null && thisDevice.environmentId === input.mainId,
    faint: false,
  });
  for (const server of input.servers) {
    if (thisDevice.environmentId === null && !server.isThisWindow) continue;
    lines.push({
      from: THIS_DEVICE,
      to: server.environmentId,
      live: server.connection === "connected",
    });
  }
  if (input.phone !== null) {
    const { phone } = input;
    const target = input.servers.find((server) => server.environmentId === phone.environmentId);
    devices.push({
      id: PHONE,
      kind: "phone",
      title: phone.deviceName ?? "Your phone",
      detail:
        phone.deviceName === null
          ? "Not set up yet"
          : `Opens ${machineInSentence(phone.computerName)}`,
      main: false,
      faint: phone.deviceName === null,
    });
    if (target !== undefined && phone.deviceName !== null) {
      lines.push({
        from: PHONE,
        to: target.environmentId,
        live: target.connection === "connected",
      });
    }
  }
  const main = [...devices, ...serverNodes].find((node) => node.main);
  const parts = [
    `${serverNodes.length === 1 ? "One server" : `${serverNodes.length} servers`}: ${serverNodes
      .map((node) => node.title)
      .join(", ")}.`,
    ...devices.map((node) => `${node.title}: ${node.detail}.`),
    main === undefined ? null : `${main.title} is the main one.`,
  ];
  return {
    devices,
    servers: serverNodes,
    lines,
    summary: parts.filter((part) => part !== null).join(" "),
  };
}

export const MAP_NODE_HEIGHT = 56;
export const MAP_NODE_GAP = 12;

/** Where each node's middle is, top to bottom, with the shorter column centred on the longer. */
export function serversMapLayout(
  deviceCount: number,
  serverCount: number,
): {
  readonly height: number;
  readonly deviceOffset: number;
  readonly serverOffset: number;
  readonly middleOf: (offset: number, index: number) => number;
} {
  const columnHeight = (count: number) =>
    count === 0 ? 0 : count * MAP_NODE_HEIGHT + (count - 1) * MAP_NODE_GAP;
  const height = Math.max(columnHeight(deviceCount), columnHeight(serverCount));
  return {
    height,
    deviceOffset: (height - columnHeight(deviceCount)) / 2,
    serverOffset: (height - columnHeight(serverCount)) / 2,
    middleOf: (offset, index) =>
      offset + index * (MAP_NODE_HEIGHT + MAP_NODE_GAP) + MAP_NODE_HEIGHT / 2,
  };
}
