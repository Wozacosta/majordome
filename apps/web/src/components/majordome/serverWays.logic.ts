import type { ServerRow } from "./servers.logic";
import type { ServerMoveView } from "./serverMove.logic";

/** The ways to get a server, each with its own page under "Your servers". */
const SERVER_WAYS = ["hosted", "rent", "own"] as const;
export type ServerWay = (typeof SERVER_WAYS)[number];

export const isServerWay = (value: unknown): value is ServerWay =>
  SERVER_WAYS.some((way) => way === value);

const SERVER_WAY_TITLES: Record<ServerWay, string> = {
  hosted: "Let Majordome host it",
  rent: "Rent one for me",
  own: "Use a server I already have",
};

const SERVER_WAY_LINES: Record<ServerWay, string> = {
  hosted: "With an invite code. Nothing to rent or install.",
  rent: "At Hetzner, about €5 a month. Ten minutes, two keys to paste.",
  own: "Any Linux server. One command to run on it.",
};

export interface ServerWayRow {
  readonly way: ServerWay;
  readonly title: string;
  readonly line: string;
}

/**
 * The ways on offer now. Notes go to one server at a time, so once they are on one, only a
 * server that exists already can still be added; none while a move is being made or undone.
 */
export function serverWayRows(input: {
  readonly view: ServerMoveView;
  /** Whether this window may set a server up: only the computer Majordome runs on can rent one. */
  readonly canManage: boolean;
}): ReadonlyArray<ServerWayRow> {
  const ways: ReadonlyArray<ServerWay> =
    input.view === "setup"
      ? input.canManage
        ? SERVER_WAYS
        : ["hosted", "own"]
      : input.view === "ready"
        ? ["own"]
        : [];
  return ways.map((way) => ({
    way,
    title: SERVER_WAY_TITLES[way],
    line: SERVER_WAY_LINES[way],
  }));
}

const INSTALL_URL = "https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy/install.sh";

/**
 * The one command that turns a server into a Majordome server. It carries the owner's time zone,
 * so routines there follow their clock and not the server's.
 */
export function ownServerCommand(timeZone: string | undefined): string {
  const zone = timeZone !== undefined && /^[A-Za-z0-9_+/-]+$/.test(timeZone) ? timeZone : null;
  return `curl -fsSL ${INSTALL_URL} | ${zone === null ? "" : `TZ=${zone} `}sh`;
}

/** The servers of the owner's own that this computer's notes could move to. */
export function ownServerTargets(servers: ReadonlyArray<ServerRow>): ReadonlyArray<ServerRow> {
  return servers.filter(
    (server) => !server.hosted && !server.isThisWindow && server.connection === "connected",
  );
}
