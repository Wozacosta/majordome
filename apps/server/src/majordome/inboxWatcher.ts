/**
 * One digest per batch of new inbox files, after the quiet period. Hidden paths, removals and
 * edits alone never start one. During a digest, events are the agent's and are ignored, except
 * new files still there when it ends: they start the next batch.
 */

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

export const INBOX_QUIET_PERIOD = Duration.minutes(2);

const isHidden = (relativePath: string) =>
  relativePath.split(/[\\/]/).some((segment) => segment.startsWith("."));

const withPath = (paths: ReadonlySet<string>, path: string) => new Set(paths).add(path);

/** Runs until `events` ends or fails. Digests run in the caller's scope. */
export const watchInbox = Effect.fn("majordome.watchInbox")(function* <E>(input: {
  /** Paths relative to the inbox folder, as `FileSystem.watch` reports them. */
  readonly events: Stream.Stream<FileSystem.WatchEvent, E>;
  readonly quietPeriod: Duration.Input;
  readonly isPresent: (relativePath: string) => Effect.Effect<boolean>;
  readonly digest: Effect.Effect<void>;
}) {
  const scope = yield* Effect.scope;
  // New files waiting for a digest.
  const pending = yield* Ref.make<ReadonlySet<string>>(new Set());
  // Files created while a digest runs; null when none runs.
  const createdDuringRun = yield* Ref.make<ReadonlySet<string> | null>(null);
  const followUps = yield* Queue.unbounded<void>();

  const keepPresent = (paths: Iterable<string>) =>
    Effect.filter([...paths], input.isPresent, { concurrency: 1 });

  const afterDigest = Effect.gen(function* () {
    const created = (yield* Ref.getAndSet(createdDuringRun, null)) ?? new Set<string>();
    const remaining = yield* keepPresent(created);
    if (remaining.length === 0) return;
    yield* Ref.update(pending, (paths) => new Set([...paths, ...remaining]));
    yield* Queue.offer(followUps, undefined);
  });

  const startDigest = Effect.gen(function* () {
    if ((yield* Ref.get(createdDuringRun)) !== null) return;
    const batch = yield* keepPresent(yield* Ref.getAndSet(pending, new Set()));
    if (batch.length === 0) return;
    // Set before forking, so events from the run's first moments are already the run's.
    yield* Ref.set(createdDuringRun, new Set());
    yield* input.digest.pipe(Effect.ensuring(afterDigest), Effect.forkIn(scope));
  });

  /** True when the event belongs to a batch, false when it is ignored. */
  // Runs per event, inside the watch's span.
  const record = Effect.fnUntraced(function* (event: FileSystem.WatchEvent) {
    if (event._tag === "Remove" || isHidden(event.path)) return false;
    const duringRun = yield* Ref.get(createdDuringRun);
    if (duringRun !== null) {
      if (event._tag === "Create")
        yield* Ref.set(createdDuringRun, withPath(duringRun, event.path));
      return false;
    }
    if (event._tag === "Create") yield* Ref.update(pending, (paths) => withPath(paths, event.path));
    return true;
  });

  yield* Stream.merge(
    input.events.pipe(Stream.filterEffect(record)),
    Stream.fromQueue(followUps),
  ).pipe(
    Stream.debounce(input.quietPeriod),
    Stream.runForEach(() => startDigest),
  );
});
