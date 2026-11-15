import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { watchInbox } from "./inboxWatcher.ts";

const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, {
  discard: true,
});

const harness = Effect.fn("test.harness")(function* (options?: {
  readonly holdDigest?: Deferred.Deferred<void>;
}) {
  const events = yield* Queue.unbounded<FileSystem.WatchEvent>();
  const present = yield* Ref.make<ReadonlySet<string>>(new Set());
  const digests = yield* Ref.make(0);
  yield* watchInbox({
    events: Stream.fromQueue(events),
    quietPeriod: "2 minutes",
    isPresent: (path) => Ref.get(present).pipe(Effect.map((paths) => paths.has(path))),
    digest: Ref.update(digests, (n) => n + 1).pipe(
      Effect.andThen(
        options?.holdDigest === undefined ? Effect.void : Deferred.await(options.holdDigest),
      ),
    ),
  }).pipe(Effect.forkScoped);
  yield* settle;

  const emit = (event: FileSystem.WatchEvent) =>
    Effect.gen(function* () {
      if (event._tag === "Create")
        yield* Ref.update(present, (paths) => new Set(paths).add(event.path));
      if (event._tag === "Remove") {
        yield* Ref.update(present, (paths) => {
          const next = new Set(paths);
          next.delete(event.path);
          return next;
        });
      }
      yield* Queue.offer(events, event);
      yield* settle;
    });
  const advance = (duration: Parameters<typeof TestClock.adjust>[0]) =>
    TestClock.adjust(duration).pipe(Effect.andThen(settle));
  return { emit, advance, digests: Ref.get(digests), present };
});

it.effect("digests once after two quiet minutes, whatever the batch size", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { emit, advance, digests } = yield* harness();
      yield* emit({ _tag: "Create", path: "scan.pdf" });
      yield* emit({ _tag: "Update", path: "scan.pdf" });
      yield* advance("1 minute");
      yield* emit({ _tag: "Create", path: "notes/idea.md" });
      yield* advance("119 seconds");
      assert.equal(yield* digests, 0);
      yield* advance("2 seconds");
      assert.equal(yield* digests, 1);
      yield* advance("10 minutes");
      assert.equal(yield* digests, 1);
    }),
  ),
);

it.effect("ignores hidden files, removals and edits to files already there", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { emit, advance, digests } = yield* harness();
      yield* emit({ _tag: "Create", path: ".DS_Store" });
      yield* emit({ _tag: "Create", path: ".obsidian/workspace.json" });
      yield* emit({ _tag: "Remove", path: "old.md" });
      yield* emit({ _tag: "Update", path: "existing.md" });
      yield* advance("5 minutes");
      assert.equal(yield* digests, 0);
    }),
  ),
);

it.effect("skips a batch whose files are gone before the quiet period ends", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { emit, advance, digests } = yield* harness();
      yield* emit({ _tag: "Create", path: "download.part" });
      yield* emit({ _tag: "Remove", path: "download.part" });
      yield* advance("3 minutes");
      assert.equal(yield* digests, 0);
    }),
  ),
);

it.effect("does not react to the digest's own changes, but keeps files dropped meanwhile", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const holdDigest = yield* Deferred.make<void>();
      const { emit, advance, digests } = yield* harness({ holdDigest });
      yield* emit({ _tag: "Create", path: "a.md" });
      yield* advance("2 minutes");
      assert.equal(yield* digests, 1);

      // While the digest runs: the agent files a.md away and writes a scratch file it removes,
      // and the user drops b.md.
      yield* emit({ _tag: "Remove", path: "a.md" });
      yield* emit({ _tag: "Create", path: "scratch.md" });
      yield* emit({ _tag: "Remove", path: "scratch.md" });
      yield* emit({ _tag: "Create", path: "b.md" });
      yield* advance("10 minutes");
      assert.equal(yield* digests, 1);

      yield* Deferred.succeed(holdDigest, undefined);
      yield* settle;
      yield* advance("119 seconds");
      assert.equal(yield* digests, 1);
      yield* advance("2 seconds");
      assert.equal(yield* digests, 2);
    }),
  ),
);
