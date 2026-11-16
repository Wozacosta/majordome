/**
 * Whether a vault's routines can run on this server, its runner: they exist and the provider each
 * one runs with is signed in. Read for the feed, and at every reconcile to notify the owner once.
 */

import type {
  MajordomeRoutinesStatus,
  ProjectId,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { hasDefaultRoutines, routineTaskId } from "./defaultRoutines.ts";
import { isProviderReady } from "./vaultModel.ts";

const blocked = (
  reason: NonNullable<MajordomeRoutinesStatus["reason"]>,
  provider?: ServerProvider,
): MajordomeRoutinesStatus => ({
  ready: false,
  reason,
  ...(provider?.displayName === undefined ? {} : { provider: provider.displayName }),
});

const isSignedOut = (provider: ServerProvider) =>
  provider.enabled && provider.auth.status === "unauthenticated";

/**
 * A provider in "warning" still runs, so only one that is off, missing, failing or signed out
 * blocks routines that exist. Routines that don't exist yet need a ready provider to be made.
 */
export function deriveRoutinesStatus(input: {
  /** This server made the vault's default routines. */
  readonly created: boolean;
  /** The provider instance of each routine that can still run. */
  readonly routineProviders: ReadonlyArray<ProviderInstanceId>;
  readonly providers: ReadonlyArray<ServerProvider>;
}): MajordomeRoutinesStatus {
  if (!input.created) {
    if (input.providers.some(isProviderReady)) return blocked("not-created");
    const signedOut = input.providers.find(isSignedOut);
    return signedOut === undefined
      ? blocked("no-provider")
      : blocked("provider-signed-out", signedOut);
  }
  for (const instanceId of new Set(input.routineProviders)) {
    const provider = input.providers.find((candidate) => candidate.instanceId === instanceId);
    if (provider === undefined) return blocked("provider-unavailable");
    if (isSignedOut(provider)) return blocked("provider-signed-out", provider);
    if (
      !provider.enabled ||
      !provider.installed ||
      provider.status === "error" ||
      provider.status === "disabled" ||
      provider.availability === "unavailable"
    ) {
      return blocked("provider-unavailable", provider);
    }
  }
  return { ready: true };
}

export const readRoutinesStatus = Effect.fn("majordome.readRoutinesStatus")(function* (input: {
  readonly ledgerPath: string;
  readonly projectId: ProjectId;
}) {
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  // "Digest my inbox" is off as a schedule and still runs when files land.
  const digestId = routineTaskId(input.projectId, "digest-my-inbox");
  const routines = (yield* scheduledTasks.list()).tasks.filter(
    (task) => task.projectId === input.projectId && (task.enabled || task.id === digestId),
  );
  return deriveRoutinesStatus({
    created: yield* hasDefaultRoutines(input.ledgerPath, input.projectId),
    routineProviders: routines.map((task) => task.modelSelection.instanceId),
    providers: yield* providers.getProviders,
  });
});
