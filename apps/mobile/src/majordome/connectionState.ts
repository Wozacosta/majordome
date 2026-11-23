/** What stands between this phone and a computer, as the owner would say it. */
export type ComputerState =
  | "switchedOff"
  | "phoneOffline"
  | "connecting"
  | "notConnected"
  | "waitingForApproval"
  | "unreachable"
  | "signInExpired"
  | "clockWrong"
  | "computerOutdated"
  | "appOutdated";

export type ComputerAction = "switchOn" | "retry" | "pairAgain" | "openComputer";

interface ConnectionFailure {
  readonly reason: string;
  readonly failureCause?: string | undefined;
  readonly serverUpdateRequired?: boolean | undefined;
}

export interface ComputerConnection {
  readonly enabled: boolean;
  /** Upstream's phase: available, offline, connecting, reconnecting, connected, unsupported, error. */
  readonly phase: string;
  readonly network?: string | undefined;
  readonly failure: ConnectionFailure | null;
}

/** The one thing wrong with a computer's connection, or null when it is connected. */
export function computerState(connection: ComputerConnection): ComputerState | null {
  const { failure, phase } = connection;
  if (!connection.enabled) return "switchedOff";
  if (phase === "connected") return null;
  if (connection.network === "offline" || phase === "offline") return "phoneOffline";
  if (failure?.serverUpdateRequired === true) return "computerOutdated";
  if (phase === "unsupported" || failure?.reason === "unsupported") return "appOutdated";
  if (failure?.reason === "approval-pending") return "waitingForApproval";
  if (failure?.failureCause === "clock_skew") return "clockWrong";
  if (failure?.reason === "authentication" || failure?.reason === "permission") {
    return "signInExpired";
  }
  // A first attempt is still under way; anything after a failure means nobody answered.
  if (failure === null) {
    return phase === "connecting" || phase === "reconnecting" ? "connecting" : "notConnected";
  }
  return "unreachable";
}

export interface ComputerStateText {
  readonly sentence: string;
  /** The button under the sentence. None while there is nothing to do but wait. */
  readonly action: { readonly label: string; readonly does: ComputerAction } | null;
  readonly failed: boolean;
}

/** One sentence and at most one thing to do, for each state. `name` is the computer's name. */
export function computerStateText(state: ComputerState, name: string): ComputerStateText {
  switch (state) {
    case "switchedOff":
      return {
        sentence: `${name} is switched off in this app.`,
        action: { label: "Switch it on", does: "switchOn" },
        failed: false,
      };
    case "phoneOffline":
      return {
        sentence: "This phone has no internet connection.",
        action: { label: "Try again", does: "retry" },
        failed: true,
      };
    case "connecting":
      return { sentence: `Connecting to ${name}…`, action: null, failed: false };
    case "notConnected":
      return {
        sentence: `Not connected to ${name}.`,
        action: { label: "Connect", does: "retry" },
        failed: false,
      };
    case "waitingForApproval":
      return {
        sentence: `Open Majordome on ${name} and approve this phone.`,
        action: null,
        failed: false,
      };
    case "unreachable":
      return {
        sentence: `${name} isn't answering. It may be asleep, switched off or without internet.`,
        action: { label: "Try again", does: "retry" },
        failed: true,
      };
    case "signInExpired":
      return {
        sentence: `${name} no longer recognises this phone.`,
        action: { label: "Scan a new code", does: "pairAgain" },
        failed: true,
      };
    case "clockWrong":
      return {
        sentence: `The date and time on this phone or on ${name} are wrong. Set both to automatic.`,
        action: { label: "Try again", does: "retry" },
        failed: true,
      };
    case "computerOutdated":
      return {
        sentence: `Majordome on ${name} is too old for this app.`,
        action: { label: "Update it", does: "openComputer" },
        failed: true,
      };
    case "appOutdated":
      return {
        sentence: `This app is too old for Majordome on ${name}. Update the app, then try again.`,
        action: { label: "Try again", does: "retry" },
        failed: true,
      };
  }
}

/** A computer's row: its state when nothing is wrong, and the two things that can be edited. */
export const MAJORDOME_COMPUTER_ROW = {
  connected: "Connected",
  name: "Name",
  address: "Address",
} as const;
