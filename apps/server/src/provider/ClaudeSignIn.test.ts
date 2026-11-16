import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  type ClaudeSignInError,
  type ProviderInstanceEnvironment,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import * as Cause from "effect/Cause";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as Settings from "../serverSettings.ts";
import * as ClaudeSignIn from "./ClaudeSignIn.ts";
import * as ProviderInstanceRegistryMutator from "./ProviderInstanceRegistryMutator.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const INSTANCE = ProviderInstanceId.make("claudeAgent");
const CODE = "auth-code-4f9c#state-77aa";
const SIGN_IN_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=client&code_challenge=challenge&state=state-77aa";
const PROMPT = `Opening browser to sign in…\r\nIf the browser didn't open, visit: \u001b]8;;${SIGN_IN_URL}\u0007${SIGN_IN_URL}\u001b]8;;\u0007\r\nPaste code here if prompted > `;
const REJECTED =
  "\r\nLogin failed: That code wasn't accepted. It may be incomplete, expired, already used, or from an earlier sign-in attempt. Sign in again to get a new code.\r\n";

interface FakeProcess extends PtyAdapter.PtyProcess {
  readonly input: PtyAdapter.PtySpawnInput;
  readonly writes: Queue.Queue<string>;
  readonly killed: Deferred.Deferred<void>;
  readonly emit: (data: string) => void;
  readonly exit: (exitCode: number) => void;
}

const makeFakeProcess = Effect.fnUntraced(function* (input: PtyAdapter.PtySpawnInput) {
  const writes = yield* Queue.unbounded<string>();
  const killed = yield* Deferred.make<void>();
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: PtyAdapter.PtyExitEvent) => void>();
  // Output from before the service listens waits for it, as a terminal's buffer does.
  const unread: Array<string> = [];
  return {
    pid: 4242,
    input,
    writes,
    killed,
    write: (data) => void Queue.offerUnsafe(writes, data),
    resize: () => {},
    kill: () => void Deferred.doneUnsafe(killed, Exit.void),
    onData: (listener) => {
      dataListeners.add(listener);
      for (const data of unread.splice(0)) listener(data);
      return () => void dataListeners.delete(listener);
    },
    onExit: (listener) => {
      exitListeners.add(listener);
      return () => void exitListeners.delete(listener);
    },
    emit: (data) => {
      if (dataListeners.size === 0) unread.push(data);
      for (const listener of dataListeners) listener(data);
    },
    exit: (exitCode) => {
      for (const listener of exitListeners) listener({ exitCode, signal: null });
    },
  } satisfies FakeProcess;
});

const authStatusSpawner = (status: object) =>
  ChildProcessSpawner.make(() =>
    Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.encodeText(Stream.make(JSON.stringify(status))),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    ),
  );

interface Harness {
  readonly spawned: Queue.Queue<FakeProcess>;
  /** Registry calls the sign-in made, in order. */
  readonly calls: ReadonlyArray<string>;
  /** Every log line and its annotations. */
  readonly logs: ReadonlyArray<string>;
}

const withSignIn = <A, E>(
  options: {
    readonly environment?: ProviderInstanceEnvironment;
    readonly hostEnvironment?: NodeJS.ProcessEnv;
    readonly authStatus?: object;
  },
  body: (
    harness: Harness,
  ) => Effect.Effect<A, E, ClaudeSignIn.ClaudeSignIn | Settings.ServerSettingsService>,
) =>
  Effect.gen(function* () {
    const spawned = yield* Queue.unbounded<FakeProcess>();
    const calls: Array<string> = [];
    const logs: Array<string> = [];
    let attempts = 0;
    const settings = Settings.ServerSettingsService.layerTest({
      providerInstances: {
        [INSTANCE]: {
          driver: "claudeAgent",
          config: { homePath: "/nonexistent/claude-home" },
          ...(options.environment ? { environment: options.environment } : {}),
        },
      },
    });
    const dependencies = Layer.mergeAll(
      Layer.succeed(PtyAdapter.PtyAdapter, {
        spawn: (input) =>
          makeFakeProcess(input).pipe(Effect.tap((process) => Queue.offer(spawned, process))),
      }),
      Layer.succeed(ProviderInstanceRegistryMutator.ProviderInstanceRegistryMutator, {
        reconcile: () => Effect.sync(() => void calls.push("reconcile")),
        rebuild: (instanceId) => Effect.sync(() => void calls.push(`rebuild:${instanceId}`)),
        reloadSecrets: () => Effect.void,
        applySecret: () => Effect.succeed([]),
      }),
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        refreshInstance: (instanceId) =>
          Effect.sync(() => {
            calls.push(`refresh:${instanceId}`);
            return [];
          }),
      }),
      Layer.succeed(
        SecureRandom.SecureRandom,
        SecureRandom.make((size) => new Uint8Array(size).fill(++attempts)),
      ),
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        authStatusSpawner(options.authStatus ?? { loggedIn: false, authMethod: "none" }),
      ),
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-claude-sign-in-" }),
    );
    const logger = Logger.make(({ message, cause }) => {
      logs.push(`${JSON.stringify(message)} ${Cause.pretty(cause)}`);
    });
    const layer = Layer.mergeAll(
      ClaudeSignIn.layer((current) => current.providerInstances).pipe(Layer.provide(dependencies)),
      Logger.layer([logger], { mergeWithExisting: false }),
    ).pipe(Layer.provideMerge(settings), Layer.provide(NodeServices.layer));
    return yield* body({ spawned, calls, logs }).pipe(
      Effect.provide(layer),
      Effect.provideService(
        HostProcess.Environment,
        options.hostEnvironment ?? { PATH: "/usr/bin" },
      ),
    );
  });

/** Starts a sign-in and answers it with the link, as Claude does. */
const startWithLink = Effect.fnUntraced(function* (harness: Harness) {
  const signIn = yield* ClaudeSignIn.ClaudeSignIn;
  const starting = yield* signIn.start({ instanceId: INSTANCE }).pipe(Effect.forkChild);
  const process = yield* Queue.take(harness.spawned);
  // The link arrives split across reads.
  process.emit(PROMPT.slice(0, 90));
  process.emit(PROMPT.slice(90));
  return { process, attempt: yield* Fiber.join(starting) };
});

const submitCode = (attemptId: string, code = CODE) =>
  ClaudeSignIn.ClaudeSignIn.pipe(
    Effect.flatMap((signIn) =>
      signIn.submit({ instanceId: INSTANCE, attemptId, code: Redacted.make(code) }),
    ),
  );

const reasonOf = (exit: Exit.Exit<unknown, ClaudeSignInError>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as ClaudeSignInError).reason : "succeeded";

const savedToken = {
  name: "CLAUDE_CODE_OAUTH_TOKEN",
  value: "sk-ant-oat01-saved",
  sensitive: true,
};
const otherVariable = { name: "HTTPS_PROXY", value: "http://proxy:8080", sensitive: false };

it.effect(
  "starts Claude's own sign-in in a terminal, without the token, and returns its link",
  () =>
    withSignIn(
      {
        environment: [savedToken, otherVariable],
        hostEnvironment: {
          PATH: "/usr/bin",
          ANTHROPIC_API_KEY: "sk-ant-api03-host",
          BROWSER: "open",
        },
      },
      (harness) =>
        Effect.gen(function* () {
          const { process, attempt } = yield* startWithLink(harness);
          assert.strictEqual(attempt.url, SIGN_IN_URL);
          assert.strictEqual(process.input.shell, "claude");
          assert.deepStrictEqual(process.input.args, ["auth", "login", "--claudeai"]);
          const { env } = process.input;
          assert.strictEqual(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
          assert.strictEqual(env.ANTHROPIC_API_KEY, undefined);
          assert.strictEqual(env.BROWSER, "true");
          assert.strictEqual(env.HTTPS_PROXY, "http://proxy:8080");
          assert.strictEqual(env.CLAUDE_CONFIG_DIR, "/nonexistent/claude-home");
        }),
    ),
);

it.effect.each([
  {
    name: "removes the saved token, which would have kept winning",
    environment: [savedToken, otherVariable],
    hostEnvironment: { PATH: "/usr/bin" },
    authStatus: { loggedIn: true, authMethod: "claude.ai" },
    result: { savedToken: "removed", serverToken: "none" },
    calls: ["reconcile", `refresh:${INSTANCE}`],
  },
  {
    name: "leaves out the server environment's token once the full sign-in is stored",
    environment: undefined,
    hostEnvironment: { PATH: "/usr/bin", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-host" },
    authStatus: { loggedIn: true, authMethod: "claude.ai" },
    result: { savedToken: "none", serverToken: "ignored" },
    calls: [`rebuild:${INSTANCE}`, `refresh:${INSTANCE}`],
  },
  {
    name: "says the server environment's token still wins when Claude reports no stored sign-in",
    environment: undefined,
    hostEnvironment: { PATH: "/usr/bin", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-host" },
    authStatus: { loggedIn: true, authMethod: "oauth_token" },
    result: { savedToken: "none", serverToken: "stillSet" },
    calls: [`rebuild:${INSTANCE}`, `refresh:${INSTANCE}`],
  },
] as const)("signs in with the pasted code and $name", (row) =>
  withSignIn(
    {
      ...(row.environment ? { environment: [...row.environment] } : {}),
      hostEnvironment: row.hostEnvironment,
      authStatus: row.authStatus,
    },
    (harness) =>
      Effect.gen(function* () {
        const { process, attempt } = yield* startWithLink(harness);
        const submitting = yield* submitCode(attempt.attemptId).pipe(Effect.forkChild);
        assert.strictEqual(yield* Queue.take(process.writes), `${CODE}\n`);
        // The terminal echoes the paste before Claude answers.
        process.emit(`${CODE}\r\n`);
        process.emit("Login successful.\r\n");
        process.exit(0);
        assert.deepStrictEqual(yield* Fiber.join(submitting), row.result);
        assert.deepStrictEqual(harness.calls, row.calls);

        const settings = yield* (yield* Settings.ServerSettingsService).getSettings;
        assert.deepStrictEqual(
          settings.providerInstances[INSTANCE]?.environment,
          row.environment ? [otherVariable] : undefined,
        );
        // The sign-in is logged, and the code the terminal echoed is in none of it.
        assert.isTrue(harness.logs.some((line) => line.includes("Claude signed in.")));
        assert.isFalse(harness.logs.some((line) => line.includes("auth-code-4f9c")));
        // Signed in, the attempt is over.
        assert.strictEqual(
          reasonOf(yield* submitCode(attempt.attemptId).pipe(Effect.exit)),
          "noAttempt",
        );
      }),
  ),
);

it.effect("reports a code Claude rejects in plain words, and ends the attempt", () =>
  withSignIn({ environment: [savedToken] }, (harness) =>
    Effect.gen(function* () {
      const { process, attempt } = yield* startWithLink(harness);
      const submitting = yield* submitCode(attempt.attemptId).pipe(Effect.forkChild);
      yield* Queue.take(process.writes);
      process.emit(`${CODE}\r\n${REJECTED}`);
      process.exit(1);
      const exit = yield* Fiber.join(submitting).pipe(Effect.exit);
      assert.strictEqual(reasonOf(exit), "codeRejected");
      assert.isFalse(
        `${Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""}${harness.logs.join("\n")}`.includes(
          "auth-code-4f9c",
        ),
      );
      // Nothing changed: the token stays and the provider is not restarted.
      assert.deepStrictEqual(harness.calls, []);
      const settings = yield* (yield* Settings.ServerSettingsService).getSettings;
      assert.deepStrictEqual(settings.providerInstances[INSTANCE]?.environment, [savedToken]);
      assert.strictEqual(
        reasonOf(yield* submitCode(attempt.attemptId).pipe(Effect.exit)),
        "noAttempt",
      );
    }),
  ),
);

it.effect("keeps the attempt open after an incomplete code", () =>
  withSignIn({}, (harness) =>
    Effect.gen(function* () {
      const { process, attempt } = yield* startWithLink(harness);
      // A code with no state half never reaches Claude.
      assert.strictEqual(
        reasonOf(yield* submitCode(attempt.attemptId, "auth-code-4f9c").pipe(Effect.exit)),
        "codeIncomplete",
      );
      assert.strictEqual(yield* Queue.size(process.writes), 0);

      const refused = yield* submitCode(attempt.attemptId).pipe(Effect.exit, Effect.forkChild);
      yield* Queue.take(process.writes);
      process.emit("Invalid code. Please make sure the full code was copied.\r\n");
      assert.strictEqual(reasonOf(yield* Fiber.join(refused)), "codeIncomplete");

      const submitting = yield* submitCode(attempt.attemptId).pipe(Effect.forkChild);
      yield* Queue.take(process.writes);
      process.emit("Login successful.\r\n");
      process.exit(0);
      assert.deepStrictEqual(yield* Fiber.join(submitting), {
        savedToken: "none",
        serverToken: "none",
      });
    }),
  ),
);

it.effect("closes a sign-in nobody finishes after fifteen minutes", () =>
  withSignIn({}, (harness) =>
    Effect.gen(function* () {
      const { process, attempt } = yield* startWithLink(harness);
      yield* TestClock.adjust("14 minutes");
      assert.isFalse(yield* Deferred.isDone(process.killed));
      yield* TestClock.adjust("1 minute");
      yield* Deferred.await(process.killed);
      assert.strictEqual(
        reasonOf(yield* submitCode(attempt.attemptId).pipe(Effect.exit)),
        "expired",
      );
    }),
  ),
);

it.effect("gives up, and stops Claude, when no link is printed", () =>
  withSignIn({}, (harness) =>
    Effect.gen(function* () {
      const signIn = yield* ClaudeSignIn.ClaudeSignIn;
      const starting = yield* signIn
        .start({ instanceId: INSTANCE })
        .pipe(Effect.exit, Effect.forkChild);
      const process = yield* Queue.take(harness.spawned);
      process.emit("Opening browser to sign in…\r\n");
      yield* TestClock.adjust("45 seconds");
      assert.strictEqual(reasonOf(yield* Fiber.join(starting)), "noLink");
      yield* Deferred.await(process.killed);
    }),
  ),
);

it.effect("a new start, a cancel, and a server shutdown each stop the process they own", () =>
  Effect.gen(function* () {
    const last = yield* withSignIn({}, (harness) =>
      Effect.gen(function* () {
        const signIn = yield* ClaudeSignIn.ClaudeSignIn;
        const first = yield* startWithLink(harness);
        const second = yield* startWithLink(harness);
        yield* Deferred.await(first.process.killed);
        assert.notStrictEqual(second.attempt.attemptId, first.attempt.attemptId);
        assert.strictEqual(
          reasonOf(yield* submitCode(first.attempt.attemptId).pipe(Effect.exit)),
          "noAttempt",
        );

        // Cancelling the replaced attempt leaves the current one alone.
        yield* signIn.cancel({ instanceId: INSTANCE, attemptId: first.attempt.attemptId });
        assert.isFalse(yield* Deferred.isDone(second.process.killed));
        yield* signIn.cancel({ instanceId: INSTANCE, attemptId: second.attempt.attemptId });
        yield* Deferred.await(second.process.killed);

        const third = yield* startWithLink(harness);
        assert.isFalse(yield* Deferred.isDone(third.process.killed));
        return third.process;
      }),
    );
    yield* Deferred.await(last.killed);
  }),
);
