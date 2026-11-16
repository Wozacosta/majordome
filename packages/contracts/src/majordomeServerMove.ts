import * as Schema from "effect/Schema";

import { EnvironmentId, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * "Set up a server for me", in the order it happens. Each step can be run again: it first looks
 * for what an earlier try already made.
 */
export const MajordomeServerMoveStepId = Schema.Literals([
  "check",
  "key",
  "server",
  "start",
  "pair",
  "notes",
]);
export type MajordomeServerMoveStepId = typeof MajordomeServerMoveStepId.Type;

/** What each step does, in the owner's words; shared by every surface that shows progress. */
export const MAJORDOME_SERVER_MOVE_STEP_LABELS: Record<MajordomeServerMoveStepId, string> = {
  check: "Check everything is ready",
  key: "Let the new server join your private network",
  server: "Create the server at Hetzner",
  start: "Wait for Majordome to start on it",
  pair: "Connect this computer to it",
  notes: "Copy your notes over",
};

export const MajordomeServerMoveStep = Schema.Struct({
  id: MajordomeServerMoveStepId,
  state: Schema.Literals(["pending", "working", "done", "failed"]),
  /** Why the step failed and what to do about it. */
  problem: Schema.optional(Schema.String),
});
export type MajordomeServerMoveStep = typeof MajordomeServerMoveStep.Type;

/**
 * `running` and `failed` are before the server is usable; `ready` is a server with the notes on
 * it, where signing in to a provider and moving routines remain; `removing` takes it all down.
 */
export const MajordomeServerMovePhase = Schema.Literals(["running", "failed", "ready", "removing"]);
export type MajordomeServerMovePhase = typeof MajordomeServerMovePhase.Type;

export const MajordomeServerMoveServer = Schema.Struct({
  name: Schema.String,
  location: Schema.String,
  serverType: Schema.String,
  /** What Hetzner bills each month, tax included, as Hetzner prints it. */
  monthlyPrice: Schema.NullOr(Schema.String),
  currency: Schema.NullOr(Schema.String),
  /** Its address on the owner's Tailscale network, once it has joined. */
  url: Schema.NullOr(Schema.String),
  environmentId: Schema.NullOr(EnvironmentId),
});
export type MajordomeServerMoveServer = typeof MajordomeServerMoveServer.Type;

export const MajordomeServerMove = Schema.Struct({
  id: Schema.String,
  projectId: ProjectId,
  startedAt: Schema.String,
  phase: MajordomeServerMovePhase,
  steps: Schema.Array(MajordomeServerMoveStep),
  /** Null until Hetzner has made the server. */
  server: Schema.NullOr(MajordomeServerMoveServer),
  /** True once the server runs the notes' routines. */
  routinesOnServer: Schema.Boolean,
});
export type MajordomeServerMove = typeof MajordomeServerMove.Type;

/** What the last "Remove this server" did, kept until the next move starts. */
export const MajordomeServerMoveRemoval = Schema.Struct({
  at: Schema.String,
  did: Schema.Array(Schema.String),
  /** What could not be removed and needs the owner's hand. */
  problems: Schema.Array(Schema.String),
});
export type MajordomeServerMoveRemoval = typeof MajordomeServerMoveRemoval.Type;

export const MajordomeServerMoveStatus = Schema.Struct({
  /** Which of the two keys are saved on this server; never the keys themselves. */
  keys: Schema.Struct({ hetzner: Schema.Boolean, tailscale: Schema.Boolean }),
  move: Schema.NullOr(MajordomeServerMove),
  removal: Schema.NullOr(MajordomeServerMoveRemoval),
});
export type MajordomeServerMoveStatus = typeof MajordomeServerMoveStatus.Type;

export const MajordomeServerMoveSaveKeysInput = Schema.Struct({
  hetznerToken: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  tailscaleSecret: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
});
export type MajordomeServerMoveSaveKeysInput = typeof MajordomeServerMoveSaveKeysInput.Type;

export const MajordomeServerMoveProblem = Schema.Struct({
  area: Schema.Literals(["hetzner", "tailscale", "notes", "this-computer"]),
  message: Schema.String,
});
export type MajordomeServerMoveProblem = typeof MajordomeServerMoveProblem.Type;

export const MajordomeServerMoveLocation = Schema.Struct({
  /** Hetzner's name for it, such as `fsn1`. */
  name: Schema.String,
  city: Schema.String,
  country: Schema.String,
  serverType: Schema.String,
  /** The server and its address for a month, tax included. */
  monthlyPrice: Schema.String,
});
export type MajordomeServerMoveLocation = typeof MajordomeServerMoveLocation.Type;

export const MajordomeServerMoveCheckInput = Schema.Struct({
  projectId: ProjectId,
});
export type MajordomeServerMoveCheckInput = typeof MajordomeServerMoveCheckInput.Type;

export const MajordomeServerMoveCheck = Schema.Struct({
  /** Everything that would stop the move, each with its fix. Empty means ready. */
  problems: Schema.Array(MajordomeServerMoveProblem),
  /** Worth knowing, not blocking. */
  notices: Schema.Array(Schema.String),
  /** Where a server can be ordered now, cheapest suitable type for each. */
  locations: Schema.Array(MajordomeServerMoveLocation),
  defaultLocation: Schema.NullOr(Schema.String),
  currency: Schema.NullOr(Schema.String),
});
export type MajordomeServerMoveCheck = typeof MajordomeServerMoveCheck.Type;

export const MajordomeServerMoveStartInput = Schema.Struct({
  projectId: ProjectId,
  location: TrimmedNonEmptyString.check(Schema.isMaxLength(32)),
});
export type MajordomeServerMoveStartInput = typeof MajordomeServerMoveStartInput.Type;

export const MajordomeServerMoveCancelInput = Schema.Struct({
  /** Keep the half-made server (billed by Hetzner) to try again, instead of removing it. */
  keep: Schema.Boolean,
});
export type MajordomeServerMoveCancelInput = typeof MajordomeServerMoveCancelInput.Type;

export const MajordomeServerMoveRemoveInput = Schema.Struct({
  /** Remove even when notes changed on the server could not be copied back first. */
  force: Schema.Boolean,
});
export type MajordomeServerMoveRemoveInput = typeof MajordomeServerMoveRemoveInput.Type;

/** A one-time link that adds the new server to the app or phone that opens it. */
export const MajordomeServerMovePairingLink = Schema.Struct({
  pairingUrl: Schema.String,
  expiresAt: Schema.String,
});
export type MajordomeServerMovePairingLink = typeof MajordomeServerMovePairingLink.Type;

export class MajordomeServerMoveError extends Schema.TaggedError<MajordomeServerMoveError>()(
  "MajordomeServerMoveError",
  {
    message: Schema.String,
    /** Set when "Remove this server" stopped only because notes could not be copied back. */
    canForce: Schema.optional(Schema.Boolean),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
