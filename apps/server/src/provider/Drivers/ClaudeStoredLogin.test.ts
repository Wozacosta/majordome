import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { resolveClaudeHostSignInToken } from "./ClaudeStoredLogin.ts";

const HOST = { PATH: "/usr/bin", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-host" };
const WITHOUT_TOKEN = { PATH: "/usr/bin" };
const STORED = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "a@b.c" });

it.layer(NodeServices.layer)("resolveClaudeHostSignInToken", (it) => {
  it.effect.each([
    {
      name: "runs without the server's token when Claude reports a stored full sign-in",
      host: HOST,
      instance: [],
      status: STORED,
      expected: { environment: WITHOUT_TOKEN, signInToken: "ignored" },
      asked: true,
    },
    {
      name: "keeps the token when it is the only sign-in",
      host: HOST,
      instance: [],
      status: JSON.stringify({ loggedIn: false, authMethod: "none" }),
      expected: { environment: HOST, signInToken: "used" },
      asked: true,
    },
    {
      name: "keeps the token when Claude's answer cannot be read",
      host: HOST,
      instance: [],
      status: "error: unknown option '--json'",
      expected: { environment: HOST, signInToken: "used" },
      asked: true,
    },
    {
      name: "leaves a token the provider's own settings carry to the owner",
      host: HOST,
      instance: [{ name: "CLAUDE_CODE_OAUTH_TOKEN", value: "sk-ant-oat01-saved", sensitive: true }],
      status: STORED,
      expected: { environment: HOST, signInToken: "none" },
      asked: false,
    },
    {
      name: "asks nothing when the server has no token",
      host: WITHOUT_TOKEN,
      instance: [],
      status: STORED,
      expected: { environment: WITHOUT_TOKEN, signInToken: "none" },
      asked: false,
    },
  ] as const)("$name", (row) =>
    Effect.gen(function* () {
      const asked: Array<{ readonly args: ReadonlyArray<string>; readonly token: unknown }> = [];
      const resolved = yield* resolveClaudeHostSignInToken({
        config: { binaryPath: "claude", homePath: "/nonexistent/claude-home" },
        instanceEnvironment: [...row.instance],
        hostEnvironment: row.host,
        cwd: process.cwd(),
      }).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((command) => {
            if (!ChildProcess.isStandardCommand(command)) return Effect.die("unexpected command");
            asked.push({
              args: command.args.map(String),
              token: command.options.env?.CLAUDE_CODE_OAUTH_TOKEN,
            });
            return Effect.succeed(
              ChildProcessSpawner.makeHandle({
                pid: ChildProcessSpawner.ProcessId(1),
                exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
                isRunning: Effect.succeed(false),
                kill: () => Effect.void,
                unref: Effect.succeed(Effect.void),
                stdin: Sink.drain,
                stdout: Stream.encodeText(Stream.make(row.status)),
                stderr: Stream.empty,
                all: Stream.empty,
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
              }),
            );
          }),
        ),
      );
      assert.deepStrictEqual(resolved, row.expected);
      // Claude is asked with the token left out, or the token would answer for itself.
      assert.deepStrictEqual(
        asked,
        row.asked ? [{ args: ["auth", "status", "--json"], token: undefined }] : [],
      );
    }),
  );
});
