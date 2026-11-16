import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import { driver } from "./driver.ts";

const encoder = new TextEncoder();

type SecurityResult = {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
  readonly hang?: boolean;
};

interface Invocation {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly shell: unknown;
}

function fakeSecurity(
  answer: (args: ReadonlyArray<string>) => SecurityResult,
  platform: NodeJS.Platform = "darwin",
) {
  const invocations: Array<Invocation> = [];
  const spawned = Deferred.makeUnsafe<void>();
  const layer = Layer.mergeAll(
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) =>
        Effect.sync(() => {
          const spawn = command as unknown as {
            readonly command: string;
            readonly args: ReadonlyArray<string>;
            readonly options: { readonly shell?: unknown };
          };
          invocations.push({
            command: spawn.command,
            args: spawn.args,
            shell: spawn.options.shell,
          });
          Deferred.doneUnsafe(spawned, Effect.void);
          const result = answer(spawn.args);
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
            stderr: Stream.make(encoder.encode(result.stderr ?? "")),
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
          });
        }),
      ),
    ),
    NodeFileSystem.layer,
    NodeCrypto.layer,
    Layer.succeed(HostProcess.Platform, platform),
  );
  return { layer, invocations, spawned };
}

describe("Keychain driver", () => {
  it.effect("asks the system tool for the item, with no shell", () => {
    const security = fakeSecurity(() => ({ stdout: "sk-live\n" }));
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* driver.read({}, ["keychain://Majordome/openai"]), ["sk-live"]);
      assert.deepStrictEqual(security.invocations, [
        {
          command: "/usr/bin/security",
          args: ["find-generic-password", "-s", "Majordome", "-a", "openai", "-w"],
          shell: false,
        },
      ]);
    }).pipe(Effect.provide(security.layer));
  });

  it.effect("passes a crafted name as one argument, never as options or a command", () => {
    const security = fakeSecurity(() => ({ stdout: "value\n" }));
    return Effect.gen(function* () {
      yield* driver.read({}, [
        "keychain://-w/-a",
        "keychain://a%20-a%20root%20-w/%24%28id%29%3B%20rm%20-rf%20~",
      ]);
      assert.deepStrictEqual(
        security.invocations.map((invocation) => invocation.args),
        [
          ["find-generic-password", "-s", "-w", "-a", "-a", "-w"],
          ["find-generic-password", "-s", "a -a root -w", "-a", "$(id); rm -rf ~", "-w"],
        ],
      );
      assert.isTrue(security.invocations.every((invocation) => invocation.shell === false));
    }).pipe(Effect.provide(security.layer));
  });

  it.effect("keeps the value's own whitespace and reads each reference in order", () => {
    const security = fakeSecurity((args) =>
      args[2] === "Gone" ? { code: 44, stderr: "could not be found" } : { stdout: " sk b \n" },
    );
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* driver.read({}, ["keychain://Gone/key", "keychain://Majordome/openai"]),
        [undefined, " sk b "],
      );
    }).pipe(Effect.provide(security.layer));
  });

  it.effect("reads an empty or malformed item as undefined", () => {
    const security = fakeSecurity(() => ({ stdout: "\n" }));
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* driver.read({}, ["keychain://Majordome/openai", "not-a-reference"]),
        [undefined, undefined],
      );
      assert.strictEqual(security.invocations.length, 1);
    }).pipe(Effect.provide(security.layer));
  });

  it.effect("gives up on an item macOS never answers for", () => {
    const security = fakeSecurity(() => ({ hang: true }));
    return Effect.gen(function* () {
      const reading = yield* driver
        .read({}, ["keychain://Majordome/openai"])
        .pipe(Effect.forkChild);
      yield* Deferred.await(security.spawned);
      yield* TestClock.adjust("1 minute");
      assert.deepStrictEqual(yield* Fiber.join(reading), [undefined]);
    }).pipe(Effect.provide(security.layer));
  });

  it.effect("reads nothing, and runs nothing, when the server is not a Mac", () => {
    const security = fakeSecurity(() => ({ stdout: "sk-live\n" }), "linux");
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* driver.read({}, ["keychain://Majordome/openai"]), [undefined]);
      assert.deepStrictEqual(security.invocations, []);
    }).pipe(Effect.provide(security.layer));
  });
});
