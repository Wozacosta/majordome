import * as Schema from "effect/Schema";

import { IsoDateTime } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

/** A connector (MCP server) as its provider reports it. `pending` means still connecting. */
export const ProviderConnector = Schema.Struct({
  /** The provider's own name for it, such as "claude.ai Gmail" or "plugin:vercel:vercel". */
  name: Schema.String,
  status: Schema.Literals(["connected", "failed", "needs-auth", "pending", "disabled"]),
});
export type ProviderConnector = typeof ProviderConnector.Type;

export const MajordomeConnectorsInput = Schema.Struct({
  /** Ask every provider again instead of answering from the last minute's check. */
  refresh: Schema.optional(Schema.Boolean),
});

const MajordomeProviderConnectors = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  /** The name the owner gave this instance, when they gave one. */
  displayName: Schema.optional(Schema.String),
  /** False when this kind of provider cannot list its connectors. */
  reported: Schema.Boolean,
  /** Why the check failed, when the provider can list connectors but this check did not. */
  error: Schema.optional(Schema.String),
  connectors: Schema.Array(ProviderConnector),
});
export type MajordomeProviderConnectors = typeof MajordomeProviderConnectors.Type;

/** What each enabled provider on this server can reach, as of `checkedAt`. */
export const MajordomeConnectorsResult = Schema.Struct({
  checkedAt: IsoDateTime,
  providers: Schema.Array(MajordomeProviderConnectors),
});
export type MajordomeConnectorsResult = typeof MajordomeConnectorsResult.Type;
