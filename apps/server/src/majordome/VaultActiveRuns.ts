/**
 * Which vaults have an agent run in progress. While one does, the owner's edits are not
 * autosaved: the run's own changes would be saved as "Your edits" and its commit, the one "Undo
 * this" reverts, would miss them. A run older than an hour (one waiting on an approval) no longer
 * holds autosave back.
 */

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { isTerminalRunStatus } from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";

const HOLD_LIMIT_MS = 60 * 60 * 1_000;

export class VaultActiveRuns extends Context.Service<
  VaultActiveRuns,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly isBusy: (vaultRoot: string) => Effect.Effect<boolean>;
  }
>()("t3/majordome/VaultActiveRuns") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const running = yield* Ref.make<
    ReadonlyMap<string, { readonly cwd: string; readonly since: number }>
  >(new Map());

  const track = Effect.fn("VaultActiveRuns.track")(function* (
    threadId: Parameters<typeof projections.getThreadShell>[0],
    terminal: boolean,
  ) {
    if (terminal) {
      return yield* Ref.update(running, (current) => {
        const next = new Map(current);
        next.delete(threadId);
        return next;
      });
    }
    if ((yield* Ref.get(running)).has(threadId)) return;
    const thread = yield* projections.getThreadShell(threadId);
    if (thread === null) return;
    const cwd =
      thread.worktreePath ??
      Option.getOrUndefined(yield* projects.get(thread.projectId))?.workspaceRoot;
    if (cwd === undefined) return;
    const since = yield* Clock.currentTimeMillis;
    yield* Ref.update(running, (current) => new Map(current).set(threadId, { cwd, since }));
  });

  const start: VaultActiveRuns["Service"]["start"] = Effect.fn("VaultActiveRuns.start")(
    function* () {
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          event.type === "run.updated"
            ? track(event.threadId, isTerminalRunStatus(event.payload.status)).pipe(Effect.ignore)
            : Effect.void,
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Majordome stopped following agent runs.", { cause }),
          ),
        ),
      );
    },
  );

  const isBusy: VaultActiveRuns["Service"]["isBusy"] = Effect.fn("VaultActiveRuns.isBusy")(
    function* (vaultRoot) {
      const now = yield* Clock.currentTimeMillis;
      for (const run of (yield* Ref.get(running)).values()) {
        if (run.cwd === vaultRoot && now - run.since < HOLD_LIMIT_MS) return true;
      }
      return false;
    },
  );

  return VaultActiveRuns.of({ start, isBusy });
});

export const layer = Layer.effect(VaultActiveRuns, make);

/** For tests: no run ever holds autosave back. */
export const layerIdle = Layer.succeed(
  VaultActiveRuns,
  VaultActiveRuns.of({
    start: Effect.fn("VaultActiveRuns.idleStart")(function* () {
      yield* Effect.void;
    }),
    isBusy: Effect.fn("VaultActiveRuns.idleIsBusy")(function* () {
      return yield* Effect.succeed(false);
    }),
  }),
);
