import {
  ClaudeSettings,
  ClaudeSignInError,
  ProviderDriverKind,
  type ClaudeSignInAttempt,
  type ClaudeSignInCancelInput,
  type ClaudeSignInResult,
  type ClaudeSignInSubmitInput,
  type ProviderInstanceConfigMap,
  type ProviderInstanceId,
  type ProviderSetupInput,
  type ServerSettings,
} from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as Settings from "../serverSettings.ts";
import {
  CLAUDE_SIGN_IN_TOKEN_VARIABLE,
  classifySignInOutput,
  claudeSignInEnvironment,
  extractSignInUrl,
  isCompleteSignInCode,
} from "./claudeSignInOutput.ts";
import { makeClaudeEnvironment, mergeClaudeProcessEnvironment } from "./Drivers/ClaudeHome.ts";
import { resolveClaudeHostSignInToken } from "./Drivers/ClaudeStoredLogin.ts";
import * as ProviderInstanceRegistryMutator from "./ProviderInstanceRegistryMutator.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const LINK_TIMEOUT = Duration.seconds(45);
// Claude's page gives a code that lasts minutes; an attempt nobody finishes must not linger.
const ATTEMPT_TIMEOUT = Duration.minutes(15);
const ANSWER_TIMEOUT = Duration.minutes(2);
const EXIT_GRACE = Duration.seconds(15);
const OUTPUT_LIMIT = 64 * 1024;

const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);

type AttemptEvent =
  | { readonly _tag: "output"; readonly data: string }
  | { readonly _tag: "exit"; readonly exitCode: number }
  | { readonly _tag: "closed" };

interface Attempt {
  readonly attemptId: string;
  readonly events: Queue.Queue<AttemptEvent>;
  readonly write: (data: string) => void;
  readonly scope: Scope.Closeable;
  readonly closed: Deferred.Deferred<void>;
  readonly answering: Semaphore.Semaphore;
}

type Slot = Attempt | { readonly attemptId: string; readonly expired: true };

/**
 * Runs Claude Code's own full sign-in (`claude auth login`) for a provider on a machine with no
 * browser: the link opens on the owner's device, and the code its page shows is pasted back.
 */
export class ClaudeSignIn extends Context.Service<
  ClaudeSignIn,
  {
    readonly start: (
      input: ProviderSetupInput,
    ) => Effect.Effect<ClaudeSignInAttempt, ClaudeSignInError>;
    readonly submit: (
      input: ClaudeSignInSubmitInput,
    ) => Effect.Effect<ClaudeSignInResult, ClaudeSignInError>;
    readonly cancel: (input: ClaudeSignInCancelInput) => Effect.Effect<void>;
  }
>()("t3/provider/ClaudeSignIn") {}

const make = Effect.fn("ClaudeSignIn.make")(function* (
  deriveProviderInstanceConfigMap: (settings: ServerSettings) => ProviderInstanceConfigMap,
) {
  const pty = yield* PtyAdapter.PtyAdapter;
  const serverSettings = yield* Settings.ServerSettingsService;
  const mutator = yield* ProviderInstanceRegistryMutator.ProviderInstanceRegistryMutator;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const random = yield* SecureRandom.SecureRandom;
  // The server cwd is $HOME in packaged builds, where `claude` wrappers refuse to run.
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const hostEnvironment = yield* HostProcess.Environment;
  const serviceScope = yield* Scope.Scope;
  const launchContext = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  >();

  const slots = yield* Ref.make<ReadonlyMap<ProviderInstanceId, Slot>>(new Map());
  const transitions = yield* Semaphore.make(1);

  const readInstance = Effect.fn("ClaudeSignIn.readInstance")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) => new ClaudeSignInError({ instanceId, reason: "unavailable", cause }),
      ),
    );
    const instance = deriveProviderInstanceConfigMap(settings)[instanceId];
    const config =
      instance?.driver === CLAUDE_DRIVER
        ? decodeClaudeSettings(instance.config ?? {})
        : Option.none();
    if (instance === undefined || Option.isNone(config)) {
      return yield* new ClaudeSignInError({ instanceId, reason: "unavailable" });
    }
    return { config: config.value, environment: instance.environment };
  });

  const resolveLaunch = Effect.fn("ClaudeSignIn.resolveLaunch")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const { config, environment } = yield* readInstance(instanceId);
    const env = claudeSignInEnvironment(
      yield* makeClaudeEnvironment(
        config,
        yield* mergeClaudeProcessEnvironment(config, environment, hostEnvironment),
      ),
    );
    const binaryPath = expandHomePath(config.binaryPath, yield* HostProcess.HomeDirectory);
    const command = yield* resolveSpawnCommand(binaryPath, ["auth", "login", "--claudeai"], {
      env,
    });
    return { command: command.command, args: [...command.args], env };
  }, Effect.provideContext(launchContext));

  const closeAttempt = (instanceId: ProviderInstanceId, attempt: Attempt, expired = false) =>
    Ref.update(slots, (current) => {
      if (current.get(instanceId) !== attempt) return current;
      const next = new Map(current);
      if (expired) next.set(instanceId, { attemptId: attempt.attemptId, expired: true });
      else next.delete(instanceId);
      return next;
    }).pipe(Effect.andThen(Scope.close(attempt.scope, Exit.void)));

  const closeCurrent = Effect.fnUntraced(function* (instanceId: ProviderInstanceId) {
    const slot = (yield* Ref.get(slots)).get(instanceId);
    if (slot === undefined) return;
    if ("expired" in slot) {
      yield* Ref.update(slots, (current) => {
        const next = new Map(current);
        next.delete(instanceId);
        return next;
      });
      return;
    }
    yield* closeAttempt(instanceId, slot);
  });

  const openAttempt = Effect.fn("ClaudeSignIn.openAttempt")(function* (
    instanceId: ProviderInstanceId,
    launch: Effect.Success<ReturnType<typeof resolveLaunch>>,
  ) {
    const attemptId = Base64Url.encode(yield* random.randomBytes(16));
    const scope = yield* Scope.fork(serviceScope);
    const events = yield* Queue.unbounded<AttemptEvent>();
    const closed = yield* Deferred.make<void>();
    yield* Scope.addFinalizer(scope, Deferred.succeed(closed, undefined));
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => Queue.offerUnsafe(events, { _tag: "closed" })),
    );
    // Claude's interactive sign-in needs a terminal; a wide one keeps the link on one line.
    const process = yield* pty
      .spawn({
        shell: launch.command,
        args: launch.args,
        cwd: stateDir,
        cols: 240,
        rows: 40,
        env: launch.env,
      })
      .pipe(
        Effect.mapError(
          (cause) => new ClaudeSignInError({ instanceId, reason: "notStarted", cause }),
        ),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      );
    let exited = false;
    const stopOutput = process.onData((data) => {
      Queue.offerUnsafe(events, { _tag: "output", data });
    });
    const stopExit = process.onExit(({ exitCode }) => {
      exited = true;
      Queue.offerUnsafe(events, { _tag: "exit", exitCode });
    });
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        stopOutput();
        stopExit();
        // Through the handle of the process this attempt spawned, never by name or pid lookup.
        if (!exited) process.kill();
      }).pipe(Effect.ignore),
    );
    return {
      attemptId,
      events,
      write: (data) => process.write(data),
      scope,
      closed,
      answering: yield* Semaphore.make(1),
    } satisfies Attempt;
  });

  // Untraced: one take per chunk of terminal output, inside the operation's own span.
  const awaitLink = Effect.fnUntraced(function* (instanceId: ProviderInstanceId, attempt: Attempt) {
    let output = "";
    while (true) {
      const event = yield* Queue.take(attempt.events);
      if (event._tag === "closed") {
        return yield* new ClaudeSignInError({ instanceId, reason: "noAttempt" });
      }
      if (event._tag === "exit") {
        return yield* new ClaudeSignInError({ instanceId, reason: "notStarted" });
      }
      output = (output + event.data).slice(-OUTPUT_LIMIT);
      const url = extractSignInUrl(output);
      if (url !== undefined) return url;
    }
  });

  const awaitExit = Effect.fnUntraced(function* (attempt: Attempt) {
    while ((yield* Queue.take(attempt.events))._tag === "output") {
      // Output after the answer changes nothing.
    }
  });

  // The terminal echoes the pasted code into `output`, so it stays in this function: it is read
  // for Claude's fixed phrases and never logged, returned, or put in an error.
  const answer = Effect.fnUntraced(function* (attempt: Attempt, code: string) {
    // What was printed before this paste says nothing about it; an ended process does.
    const earlier = yield* Queue.clear(attempt.events);
    if (earlier.some((event) => event._tag !== "output")) return "failed" as const;
    const written = yield* Effect.try({
      try: () => attempt.write(`${code}\n`),
      catch: () => "failed" as const,
    }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!written) return "failed" as const;
    let output = "";
    while (true) {
      const event = yield* Queue.take(attempt.events);
      if (event._tag === "closed") return "failed" as const;
      if (event._tag === "exit") {
        if (event.exitCode === 0) return "signedIn" as const;
        const late = yield* Queue.clear(attempt.events);
        for (const next of late) if (next._tag === "output") output += next.data;
        return classifySignInOutput(output) === "codeRejected"
          ? ("codeRejected" as const)
          : ("failed" as const);
      }
      output = (output + event.data).slice(-OUTPUT_LIMIT);
      const said = classifySignInOutput(output);
      // Claude asks again after an incomplete code, so the attempt stays open.
      if (said === "codeIncomplete") return said;
      if (said === "signedIn") {
        yield* awaitExit(attempt).pipe(Effect.timeoutOption(EXIT_GRACE));
        return said;
      }
    }
  });

  const removeSavedToken = Effect.fn("ClaudeSignIn.removeSavedToken")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const settings = yield* serverSettings.getSettings;
    const instance = settings.providerInstances[instanceId];
    const environment = instance?.environment ?? [];
    const kept = environment.filter(
      (variable) => variable.name.toUpperCase() !== CLAUDE_SIGN_IN_TOKEN_VARIABLE,
    );
    if (instance === undefined || kept.length === environment.length) return undefined;
    const { environment: _withToken, ...rest } = instance;
    return yield* serverSettings.updateProviderInstance({
      operation: "upsert",
      instanceId,
      instance: kept.length > 0 ? { ...rest, environment: kept } : rest,
    });
  });

  const readServerToken = Effect.fn("ClaudeSignIn.readServerToken")(
    function* (instanceId: ProviderInstanceId) {
      const { config, environment } = yield* readInstance(instanceId);
      const resolved = yield* resolveClaudeHostSignInToken({
        config,
        instanceEnvironment: environment,
        hostEnvironment,
        cwd: stateDir,
      });
      return resolved.signInToken === "used" ? ("stillSet" as const) : resolved.signInToken;
    },
    Effect.provideContext(launchContext),
    Effect.orElseSucceed(() => "none" as const),
  );

  /**
   * A sign-in token still in play would keep winning, so the owner would sign in and see no
   * change. The saved one is removed; the server's own is left out by the driver once a full
   * sign-in is stored. Either way the provider restarts, because its credential changed.
   */
  const finish = Effect.fn("ClaudeSignIn.finish")(function* (instanceId: ProviderInstanceId) {
    const removed = yield* removeSavedToken(instanceId).pipe(
      Effect.map((settings) =>
        settings === undefined
          ? { savedToken: "none" as const }
          : { savedToken: "removed" as const, settings },
      ),
      Effect.catch((error) =>
        Effect.logWarning("Could not remove the saved Claude sign-in token.", {
          instanceId,
          operation: error.operation,
        }).pipe(Effect.as({ savedToken: "stillSet" as const })),
      ),
    );
    const serverToken =
      removed.savedToken === "stillSet" ? ("none" as const) : yield* readServerToken(instanceId);
    yield* "settings" in removed
      ? mutator.reconcile(deriveProviderInstanceConfigMap(removed.settings))
      : mutator.rebuild(instanceId);
    yield* providerRegistry.refreshInstance(instanceId);
    yield* Effect.logInfo("Claude signed in.", {
      instanceId,
      savedToken: removed.savedToken,
      serverToken,
    });
    return { savedToken: removed.savedToken, serverToken } satisfies ClaudeSignInResult;
  });

  const settle = Effect.fn("ClaudeSignIn.settle")(function* (
    instanceId: ProviderInstanceId,
    attempt: Attempt,
    code: string,
  ) {
    const outcome = yield* attempt.answering
      .withPermits(1)(answer(attempt, code))
      .pipe(
        Effect.timeoutOption(ANSWER_TIMEOUT),
        Effect.map(Option.getOrElse(() => "noAnswer" as const)),
      );
    if (outcome === "codeIncomplete") {
      return yield* new ClaudeSignInError({ instanceId, reason: outcome });
    }
    yield* closeAttempt(instanceId, attempt);
    if (outcome !== "signedIn") {
      return yield* new ClaudeSignInError({ instanceId, reason: outcome });
    }
    return yield* finish(instanceId);
  });

  const start: ClaudeSignIn["Service"]["start"] = Effect.fn("ClaudeSignIn.start")(function* ({
    instanceId,
  }) {
    const launch = yield* resolveLaunch(instanceId);
    const attempt = yield* transitions.withPermits(1)(
      Effect.gen(function* () {
        yield* closeCurrent(instanceId);
        const opened = yield* openAttempt(instanceId, launch);
        yield* Ref.update(slots, (current) => new Map(current).set(instanceId, opened));
        return opened;
      }),
    );
    const url = yield* awaitLink(instanceId, attempt).pipe(
      Effect.timeoutOption(LINK_TIMEOUT),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new ClaudeSignInError({ instanceId, reason: "noLink" })),
          onSome: Effect.succeed,
        }),
      ),
      Effect.onExit((exit) =>
        Exit.isSuccess(exit) ? Effect.void : closeAttempt(instanceId, attempt),
      ),
    );
    yield* Deferred.await(attempt.closed).pipe(
      Effect.timeoutOption(ATTEMPT_TIMEOUT),
      Effect.flatMap(
        Option.match({
          onNone: () => closeAttempt(instanceId, attempt, true),
          onSome: () => Effect.void,
        }),
      ),
      Effect.forkIn(serviceScope),
    );
    return {
      attemptId: attempt.attemptId,
      url,
      expiresAt: DateTime.formatIso(DateTime.add(yield* DateTime.now, { minutes: 15 })),
    };
  });

  const submit: ClaudeSignIn["Service"]["submit"] = Effect.fn("ClaudeSignIn.submit")(
    function* (input) {
      const { instanceId } = input;
      const slot = (yield* Ref.get(slots)).get(instanceId);
      if (slot === undefined || slot.attemptId !== input.attemptId) {
        return yield* new ClaudeSignInError({ instanceId, reason: "noAttempt" });
      }
      if ("expired" in slot) {
        return yield* new ClaudeSignInError({ instanceId, reason: "expired" });
      }
      const code = Redacted.value(input.code);
      if (!isCompleteSignInCode(code)) {
        return yield* new ClaudeSignInError({ instanceId, reason: "codeIncomplete" });
      }
      // Once the code is written Claude may sign in whether or not this request survives, so
      // the outcome is settled on the service's scope and a dropped connection only stops waiting.
      const settling = yield* settle(instanceId, slot, code).pipe(Effect.forkIn(serviceScope));
      return yield* Fiber.join(settling);
    },
  );

  const cancel: ClaudeSignIn["Service"]["cancel"] = Effect.fn("ClaudeSignIn.cancel")(
    function* (input) {
      yield* transitions.withPermits(1)(
        Effect.gen(function* () {
          const slot = (yield* Ref.get(slots)).get(input.instanceId);
          if (slot?.attemptId === input.attemptId) yield* closeCurrent(input.instanceId);
        }),
      );
    },
  );

  return ClaudeSignIn.of({ start, submit, cancel });
});

export const layer = (
  deriveProviderInstanceConfigMap: (settings: ServerSettings) => ProviderInstanceConfigMap,
) => Layer.effect(ClaudeSignIn, make(deriveProviderInstanceConfigMap));
