import { assert, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { vaultChangeRevisions } from "./vaultChanges.ts";

const writes = (...paths: ReadonlyArray<string>) =>
  Stream.fromIterable(paths.map((path): FileSystem.WatchEvent => ({ _tag: "Update", path })));
const pause = (millis: number) => Stream.fromEffectDrain(Effect.sleep(millis));

it.effect("signals once per quiet burst of note changes and never for plumbing", () =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis;
    const events = Stream.flatten(
      Stream.make(
        writes("Note.md", ".obsidian/workspace.json", "Note.md"),
        pause(500),
        writes("daily/2026-11-15.md"),
        pause(5_000),
        writes(".git/index", ".majordome/topics.json", "node_modules/x/index.js"),
        pause(5_000),
        writes("projects/Plan.md"),
        pause(5_000),
      ),
    );
    const fiber = yield* vaultChangeRevisions(events, "1 second").pipe(
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* TestClock.adjust("1 minute");
    assert.deepStrictEqual(
      (yield* Fiber.join(fiber)).map((revision) => revision - start),
      [1_500, 11_500],
    );
  }),
);
