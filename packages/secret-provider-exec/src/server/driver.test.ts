import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import { driver } from "./driver.ts";

const encoder = new TextEncoder();

type ProgramResult = {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
  readonly hang?: boolean;
  readonly missing?: boolean;
};

interface Invocation {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly shell: unknown;
}

function fakeProgram(answer: (args: ReadonlyArray<string>) => ProgramResult) {
  const invocations: Array<Invocation> = [];
  const spawned = Deferred.makeUnsafe<void>();
  const layer = Layer.mergeAll(
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) =>
        Effect.suspend(() => {
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
          if (result.missing) {
            return Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "ChildProcess",
                method: "spawn",
                description: "ENOENT",
              }),
            );
          }
          return Effect.succeed(
            ChildProcessSpawner.makeHandle({
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
            }),
          );
        }),
      ),
    ),
    NodeFileSystem.layer,
    NodeCrypto.layer,
  );
  return { layer, invocations, spawned };
}

const infisical = { command: "/usr/local/bin/infisical", args: ["secrets", "get", "--plain"] };

describe("Command driver", () => {
  it.effect("runs the program with its fixed arguments and the name last, with no shell", () => {
    const program = fakeProgram(() => ({ stdout: "sk-live\n" }));
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* driver.read(infisical, ["exec://OPENAI_API_KEY"]), ["sk-live"]);
      assert.deepStrictEqual(program.invocations, [
        {
          command: "/usr/local/bin/infisical",
          args: ["secrets", "get", "--plain", "OPENAI_API_KEY"],
          shell: false,
        },
      ]);
    }).pipe(Effect.provide(program.layer));
  });

  it.effect("hands shell syntax in the settings to the program as plain text", () => {
    const program = fakeProgram(() => ({ stdout: "value" }));
    return Effect.gen(function* () {
      yield* driver.read({ command: "pass", args: ["show; id", "$(whoami)", "a b"] }, [
        "exec://work/openai",
      ]);
      assert.deepStrictEqual(program.invocations, [
        { command: "pass", args: ["show; id", "$(whoami)", "a b", "work/openai"], shell: false },
      ]);
    }).pipe(Effect.provide(program.layer));
  });

  it.effect("never runs the program for a crafted reference", () => {
    const program = fakeProgram(() => ({ stdout: "value" }));
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* driver.read({ command: "pass" }, [
          "exec://--help",
          "exec://a;id",
          "exec://$(id)",
          "exec://../../etc/passwd",
          "exec://a b",
        ]),
        [undefined, undefined, undefined, undefined, undefined],
      );
      assert.deepStrictEqual(program.invocations, []);
    }).pipe(Effect.provide(program.layer));
  });

  it.effect("reads a failed, silent or missing program as undefined, in input order", () => {
    const program = fakeProgram((args) => {
      const name = args.at(-1);
      if (name === "DENIED") return { code: 1, stdout: "partial", stderr: "token sk-oops expired" };
      if (name === "EMPTY") return { stdout: " \n" };
      if (name === "MISSING") return { missing: true };
      return { stdout: "  sk-live\r\n" };
    });
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* driver.read(infisical, [
          "exec://DENIED",
          "exec://OPENAI_API_KEY",
          "exec://EMPTY",
          "exec://MISSING",
        ]),
        [undefined, "sk-live", undefined, undefined],
      );
    }).pipe(Effect.provide(program.layer));
  });

  it.effect("gives up on a program that takes longer than ten seconds", () => {
    const program = fakeProgram(() => ({ hang: true }));
    return Effect.gen(function* () {
      const reading = yield* driver
        .read(infisical, ["exec://OPENAI_API_KEY"])
        .pipe(Effect.forkChild);
      yield* Deferred.await(program.spawned);
      yield* TestClock.adjust("9 seconds");
      assert.isUndefined(reading.pollUnsafe());
      yield* TestClock.adjust("2 seconds");
      assert.deepStrictEqual(yield* Fiber.join(reading), [undefined]);
    }).pipe(Effect.provide(program.layer));
  });

  it.effect("reads nothing with settings that are not a program", () => {
    const program = fakeProgram(() => ({ stdout: "value" }));
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* driver.read({ command: "--version" }, ["exec://OPENAI_API_KEY"]),
        [undefined],
      );
      assert.deepStrictEqual(program.invocations, []);
    }).pipe(Effect.provide(program.layer));
  });
});
