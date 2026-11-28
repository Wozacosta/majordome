import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** An app that can be connected from Majordome. */
export const MajordomeApp = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  about: Schema.String,
  /** Can only be connected from a browser on the computer this server runs on. */
  thisComputerOnly: Schema.optional(Schema.Boolean),
});
export type MajordomeApp = typeof MajordomeApp.Type;

/** An app the owner signed in to on this server. Every AI on the server can use it. */
export const MajordomeConnection = Schema.Struct({
  appId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  /** `needs-sign-in` when the app no longer accepts the sign-in it was given. */
  state: Schema.Literals(["connected", "needs-sign-in"]),
  addedAt: Schema.String,
  lastUsedAt: Schema.optional(Schema.String),
  /** Off by default: a routine may then only use the tools the app marks as read-only. */
  routinesMayChange: Schema.Boolean,
});
export type MajordomeConnection = typeof MajordomeConnection.Type;

export const MajordomeConnectionsResult = Schema.Struct({
  apps: Schema.Array(MajordomeApp),
  connections: Schema.Array(MajordomeConnection),
});
export type MajordomeConnectionsResult = typeof MajordomeConnectionsResult.Type;

export const MajordomeConnectionStartInput = Schema.Struct({
  appId: TrimmedNonEmptyString,
  /** The address the owner's browser reaches this server at, as `URL.origin` gives it. */
  origin: TrimmedNonEmptyString,
});
export type MajordomeConnectionStartInput = typeof MajordomeConnectionStartInput.Type;

export const MajordomeConnectionStartResult = Schema.Struct({
  /** The app's page to open in a browser, where the owner approves. */
  authorizationUrl: Schema.String,
});
export type MajordomeConnectionStartResult = typeof MajordomeConnectionStartResult.Type;

export const MajordomeConnectionInput = Schema.Struct({ appId: TrimmedNonEmptyString });
export type MajordomeConnectionInput = typeof MajordomeConnectionInput.Type;

export const MajordomeConnectionRoutinesInput = Schema.Struct({
  appId: TrimmedNonEmptyString,
  routinesMayChange: Schema.Boolean,
});
export type MajordomeConnectionRoutinesInput = typeof MajordomeConnectionRoutinesInput.Type;

export class MajordomeConnectionsError extends Schema.TaggedError<MajordomeConnectionsError>()(
  "MajordomeConnectionsError",
  { message: Schema.String },
) {}
