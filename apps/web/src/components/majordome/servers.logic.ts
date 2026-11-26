import type { EnvironmentId, MajordomeRoutinesRunner, ProjectId } from "@t3tools/contracts";

import { isHostedServer } from "./brains.logic";
import type { OverviewTone } from "./overview.logic";

/** A computer other than this one that the app is connected to, as "Your servers" lists it. */
export interface ServerRow {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly address: string | null;
  /** One Majordome hosts, which nobody here rented or set up. */
  readonly hosted: boolean;
  readonly connection: "connected" | "connecting" | "disconnected";
  /** Null while the server cannot say, or has not said yet. */
  readonly hasNotes: boolean | null;
  readonly runsRoutines: boolean;
  readonly signedIn: boolean | null;
  /** The window's own server, in a browser or on a phone: it cannot be removed from itself. */
  readonly isThisWindow: boolean;
}

export interface ServerRowInput {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly address: string | null;
  readonly phase: string;
  readonly isThisWindow: boolean;
  readonly signedIn: boolean;
}

/**
 * The servers in the order they matter: the one that runs the routines first, then the others
 * as given. `copies` holds each connected server's notes folders; a folder still loading is
 * `undefined`, one that is no notes folder is `null`.
 */
export function serverRows(input: {
  readonly servers: ReadonlyArray<ServerRowInput>;
  readonly copies: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly routinesRunner: MajordomeRoutinesRunner | null | undefined;
    readonly isVault: boolean | undefined;
  }>;
}): ReadonlyArray<ServerRow> {
  const rows = input.servers.map((server): ServerRow => {
    const connection =
      server.phase === "connected"
        ? "connected"
        : server.phase === "connecting" || server.phase === "backoff"
          ? "connecting"
          : "disconnected";
    const copies = input.copies.filter((copy) => copy.environmentId === server.environmentId);
    const known = connection === "connected" && copies.every((copy) => copy.isVault !== undefined);
    return {
      environmentId: server.environmentId,
      name: server.name,
      address: server.address,
      hosted: isHostedServer(server.name),
      connection,
      hasNotes: known ? copies.some((copy) => copy.isVault === true) : null,
      runsRoutines: copies.some((copy) => copy.routinesRunner === "this-server"),
      signedIn: connection === "connected" ? server.signedIn : null,
      isThisWindow: server.isThisWindow,
    };
  });
  return [...rows.filter((row) => row.runsRoutines), ...rows.filter((row) => !row.runsRoutines)];
}

export interface ServerLine {
  readonly tone: OverviewTone;
  readonly text: string;
  /** The line is about the server having no AI account, which its accounts page fixes. */
  readonly signIn?: true;
}

/** What one server's entry says, most pressing first. */
export function serverLines(row: ServerRow): ReadonlyArray<ServerLine> {
  if (row.connection === "disconnected") {
    return [{ tone: "warning", text: "This app can't reach it right now." }];
  }
  if (row.connection === "connecting") return [{ tone: "neutral", text: "Connecting…" }];
  const lines: Array<ServerLine> = [];
  if (row.hasNotes === true) {
    lines.push({
      tone: "ok",
      text: row.runsRoutines
        ? "Has a copy of your notes and runs your routines."
        : "Has a copy of your notes.",
    });
  } else if (row.hasNotes === false) {
    lines.push({ tone: "neutral", text: "Connected. None of your notes are on it." });
  } else {
    lines.push({ tone: "neutral", text: "Connected." });
  }
  if (row.signedIn === false) {
    lines.push({
      tone: "warning",
      text: "Not signed in to an AI account, so the assistant cannot answer there.",
      signIn: true,
    });
  }
  return lines;
}

/** One notes folder whose routines run on several computers at once, so each runs several times. */
export interface RoutinesClash {
  readonly key: string;
  readonly title: string;
  readonly runners: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly name: string;
  }>;
}

/** One notes folder with every computer's copy; a copy that has not answered has no runner. */
export interface RunnerBrain {
  readonly key: string;
  readonly title: string;
  readonly copies: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly name: string;
    readonly routinesRunner: MajordomeRoutinesRunner | null | undefined;
  }>;
}

/**
 * The notes folders with more than one runner. Each copy names the runner in a file that travels
 * with the notes; when a move never reaches one computer, that one goes on believing it is the
 * runner. A copy that has not answered counts as no runner, so nothing is claimed on a guess.
 */
export function routinesClashes(brains: ReadonlyArray<RunnerBrain>): ReadonlyArray<RoutinesClash> {
  return brains.flatMap((brain) => {
    const runners = brain.copies
      .filter((copy) => copy.routinesRunner === "this-server")
      .map(({ environmentId, projectId, name }) => ({ environmentId, projectId, name }));
    return runners.length > 1 ? [{ key: brain.key, title: brain.title, runners }] : [];
  });
}

/** Making one server the main one: its copy takes the routines, and each other runner is told. */
export interface MainMove {
  readonly title: string;
  readonly target: RoutinesClash["runners"][number];
  readonly stop: RoutinesClash["runners"];
}

/**
 * What it takes to make `row` the main server for one notes folder, or null when it cannot be
 * offered: the server must hold the notes and have a signed-in AI, or it would run nothing and
 * answer nothing. The chats follow the routines, see `conversationHome`.
 */
export function mainMove(
  row: ServerRow,
  brain: RunnerBrain | undefined,
  mainId: EnvironmentId | null,
): MainMove | null {
  if (
    brain === undefined ||
    mainId === null ||
    row.environmentId === mainId ||
    row.connection !== "connected" ||
    row.signedIn !== true
  ) {
    return null;
  }
  const pick = ({ environmentId, projectId, name }: RunnerBrain["copies"][number]) => ({
    environmentId,
    projectId,
    name,
  });
  const target = brain.copies.find((copy) => copy.environmentId === row.environmentId);
  if (target === undefined || target.routinesRunner == null) return null;
  return {
    title: brain.title,
    target: pick(target),
    stop: brain.copies
      .filter((copy) => copy !== target && copy.routinesRunner === "this-server")
      .map(pick),
  };
}
