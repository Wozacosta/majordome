/**
 * What the "Always-on server" screen shows for each state of "Set up a server for me". Progress
 * is the server's own account of each step; nothing here guesses how far it got.
 */

import {
  MAJORDOME_SERVER_MOVE_STEP_LABELS,
  type MajordomeServerMove,
  type MajordomeServerMoveCheck,
  type MajordomeServerMoveLocation,
  type MajordomeServerMoveProblem,
  type MajordomeServerMoveStatus,
  type MajordomeServerMoveStep,
  type ServerProvider,
} from "@t3tools/contracts";

import type { OverviewTone } from "./overview.logic";

/** Which part of the screen is in charge. */
export type ServerMoveView = "setup" | "progress" | "ready" | "removing";

export function serverMoveView(status: MajordomeServerMoveStatus): ServerMoveView {
  switch (status.move?.phase) {
    case undefined:
      return "setup";
    case "running":
    case "failed":
      return "progress";
    case "ready":
      return "ready";
    case "removing":
      return "removing";
  }
}

export interface ServerMoveStepRow {
  readonly id: MajordomeServerMoveStep["id"];
  readonly label: string;
  readonly state: MajordomeServerMoveStep["state"];
  readonly tone: OverviewTone;
  /** Read out with the label: a dot's colour alone says nothing to a screen reader. */
  readonly stateLabel: string;
  readonly problem: string | null;
}

const STEP_TONE: Record<MajordomeServerMoveStep["state"], OverviewTone> = {
  pending: "neutral",
  working: "neutral",
  done: "ok",
  failed: "error",
};

const STEP_STATE_LABEL: Record<MajordomeServerMoveStep["state"], string> = {
  pending: "Not started",
  working: "In progress",
  done: "Done",
  failed: "Failed",
};

export function serverMoveStepRows(move: MajordomeServerMove): ReadonlyArray<ServerMoveStepRow> {
  return move.steps.map((step) => ({
    id: step.id,
    label:
      move.hosted === true && step.id === "start"
        ? move.own === true
          ? "Find your server"
          : "Find your Majordome server"
        : MAJORDOME_SERVER_MOVE_STEP_LABELS[step.id],
    state: step.state,
    tone: STEP_TONE[step.state],
    stateLabel: STEP_STATE_LABEL[step.state],
    problem: step.state === "failed" ? (step.problem ?? "This step did not finish.") : null,
  }));
}

/** `"4.75"` and `"EUR"` as the owner's locale writes money; the bare number without a currency. */
export function formatMonthlyPrice(
  price: string,
  currency: string | null,
  locale?: string,
): string {
  const amount = Number.parseFloat(price);
  if (currency === null || Number.isNaN(amount)) return price;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${price} ${currency}`;
  }
}

function countryName(code: string, locale?: string): string {
  try {
    return (
      new Intl.DisplayNames(locale === undefined ? undefined : [locale], {
        type: "region",
      }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

/** A location as a choice: where it is and what a month there costs. */
export function locationLabel(
  location: MajordomeServerMoveLocation,
  currency: string | null,
  locale?: string,
): string {
  // Hetzner names US cities with their state ("Ashburn, VA"); the country says enough.
  const city = location.city.split(",")[0]!.trim();
  return `${city}, ${countryName(location.country, locale)} · ${formatMonthlyPrice(location.monthlyPrice, currency, locale)} a month`;
}

/** The location to start with: the owner's choice while it is still on offer, else the default. */
export function chosenLocation(
  check: MajordomeServerMoveCheck | null,
  picked: string | null,
): MajordomeServerMoveLocation | null {
  if (check === null) return null;
  return (
    check.locations.find((location) => location.name === picked) ??
    check.locations.find((location) => location.name === check.defaultLocation) ??
    check.locations[0] ??
    null
  );
}

/** A check's problems under the key they are about; the rest belong to this computer or the notes. */
export function problemsFor(
  check: MajordomeServerMoveCheck | null,
  area: MajordomeServerMoveProblem["area"] | "other",
): ReadonlyArray<string> {
  if (check === null) return [];
  return check.problems
    .filter((problem) =>
      area === "other"
        ? problem.area === "notes" || problem.area === "this-computer"
        : problem.area === area,
    )
    .map((problem) => problem.message);
}

export type ServerKey = "hetzner" | "tailscale";

/** The key whose steps are open: the one being changed, else the first one not saved yet. */
export function openServerKey(
  keys: MajordomeServerMoveStatus["keys"],
  changing: ServerKey | null,
): ServerKey | null {
  if (changing !== null) return changing;
  if (!keys.hetzner) return "hetzner";
  return keys.tailscale ? null : "tailscale";
}

/**
 * What the one main button does: nothing until both keys are saved, then a check, and the setup
 * itself only after a check that found nothing wrong and offered somewhere to put the server.
 */
export function serverSetupAction(input: {
  readonly status: MajordomeServerMoveStatus;
  readonly check: MajordomeServerMoveCheck | null;
  readonly projectId: string | null;
}): "check" | "start" | null {
  const { status, check } = input;
  if (input.projectId === null || status.move !== null) return null;
  if (!status.keys.hetzner || !status.keys.tailscale) return null;
  return check !== null && check.problems.length === 0 && chosenLocation(check, null) !== null
    ? "start"
    : "check";
}

/** A provider the new server can run conversations and routines with. */
export function hasReadyProvider(providers: ReadonlyArray<ServerProvider> | undefined): boolean {
  return (providers ?? []).some(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.status === "ready" &&
      provider.availability !== "unavailable",
  );
}

/**
 * What is left for the owner once the server is up, in order: this app must know the server
 * before its sign-in page can open, and routines only move to a server that can run them.
 */
export type ServerMoveNextStep = "add-to-app" | "sign-in" | "move-routines" | "done";

export function serverMoveNextStep(input: {
  readonly move: MajordomeServerMove;
  /** The server is among this app's saved environments. */
  readonly saved: boolean;
  readonly providerReady: boolean;
}): ServerMoveNextStep {
  if (input.move.routinesOnServer) return "done";
  if (!input.saved) return "add-to-app";
  return input.providerReady ? "move-routines" : "sign-in";
}

/** "cx23 in Falkenstein, €4.75 a month, billed by Hetzner", from what the move recorded. */
export function serverSummary(move: MajordomeServerMove, locale?: string): string | null {
  const server = move.server;
  if (server === null) return null;
  const price =
    server.monthlyPrice === null
      ? null
      : `${formatMonthlyPrice(server.monthlyPrice, server.currency, locale)} a month, billed by Hetzner`;
  return [`${server.name} (${server.serverType}, ${server.location})`, price]
    .filter((part) => part !== null)
    .join(" · ");
}
