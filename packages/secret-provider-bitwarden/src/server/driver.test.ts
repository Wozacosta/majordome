import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import { makeDriver } from "./driver.ts";

const encoder = new TextEncoder();
const TOKEN = "0.48c78342-1635-48a6-accd-afbe01336365.secret:part";
const GARMIN = "2863ced6-eba1-48b4-b5c0-afa30104877a";
const STRAVA = "11111111-2222-3333-4444-555555555555";

type BwsResult = { readonly stdout?: string; readonly code?: number; readonly hang?: boolean };

/** Stands in for the `bws` program: records how it was started and answers from `answer`. */
function fakeBws(answer: (args: ReadonlyArray<string>) => BwsResult) {
  const invocations: Array<{
    readonly args: ReadonlyArray<string>;
    readonly env: Readonly<Record<string, string | undefined>>;
  }> = [];
  const spawned = Deferred.makeUnsafe<void>();
  const layer = Layer.mergeAll(
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) =>
        Effect.sync(() => {
          const { args, options } = command as unknown as {
            readonly args: ReadonlyArray<string>;
            readonly options: { readonly env?: Record<string, string | undefined> };
          };
          invocations.push({ args, env: options.env ?? {} });
          Deferred.doneUnsafe(spawned, Effect.void);
          const result = answer(args);
          return ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: result.hang
              ? Effect.never
              : Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            unref: Effect.succeed(Effect.void),
            stdin: Sink.drain,
            stdout: Stream.make(encoder.encode(result.stdout ?? "")),
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
          });
        }),
      ),
    ),
    NodeFileSystem.layer,
    NodeCrypto.layer,
  );
  return { layer, invocations, spawned };
}

const secretJson = (value: string) =>
  JSON.stringify({ object: "secret", id: GARMIN, key: "GARMIN", value, note: "" });

const driver = makeDriver((name) =>
  Effect.succeed(name === "bitwarden" ? `${TOKEN}\n` : undefined),
);

describe("Bitwarden Secrets Manager driver", () => {
  it.effect(
    "reads a secret by ID with the token in the environment, never in the arguments",
    () => {
      const bws = fakeBws(() => ({ stdout: secretJson(" gm-live ") }));
      return Effect.gen(function* () {
        assert.deepStrictEqual(
          yield* driver.read({ tokenName: "bitwarden", serverUrl: "https://vault.bitwarden.eu" }, [
            `bws://${GARMIN}`,
          ]),
          [" gm-live "],
        );
        assert.deepStrictEqual(bws.invocations[0]?.args, [
          "secret",
          "get",
          GARMIN,
          "--output",
          "json",
          "--color",
          "no",
          "--server-url",
          "https://vault.bitwarden.eu",
        ]);
        assert.strictEqual(bws.invocations[0]?.env.BWS_ACCESS_TOKEN, TOKEN);
        assert.notInclude(bws.invocations[0]?.args.join(" "), TOKEN);
      }).pipe(Effect.provide(bws.layer));
    },
  );

  it.effect("reads each reference on its own, and a failed one as undefined", () => {
    const bws = fakeBws((args) =>
      args.includes(STRAVA) ? { code: 1 } : { stdout: secretJson("gm-live") },
    );
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* driver.read({ tokenName: "bitwarden" }, [
          `bws://${GARMIN}`,
          `bws://${STRAVA}`,
          "bws://not-an-id",
        ]),
        ["gm-live", undefined, undefined],
      );
      assert.strictEqual(bws.invocations.length, 2);
      assert.isFalse(bws.invocations[0]?.args.includes("--server-url"));
    }).pipe(Effect.provide(bws.layer));
  });

  it.effect("starts nothing when the access token is not saved, or bws prints no secret", () => {
    const bws = fakeBws(() => ({ stdout: "Error: Missing access token" }));
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* driver.read({ tokenName: "missing" }, [`bws://${GARMIN}`]), [
        undefined,
      ]);
      assert.strictEqual(bws.invocations.length, 0);
      assert.deepStrictEqual(yield* driver.read({ tokenName: "bitwarden" }, [`bws://${GARMIN}`]), [
        undefined,
      ]);
    }).pipe(Effect.provide(bws.layer));
  });

  it.effect("gives up on a read that never answers", () => {
    const bws = fakeBws(() => ({ hang: true }));
    return Effect.gen(function* () {
      const reading = yield* driver
        .read({ tokenName: "bitwarden" }, [`bws://${GARMIN}`])
        .pipe(Effect.forkChild);
      yield* Deferred.await(bws.spawned);
      yield* TestClock.adjust("1 minute");
      assert.deepStrictEqual(yield* Fiber.join(reading), [undefined]);
    }).pipe(Effect.provide(bws.layer));
  });
});
