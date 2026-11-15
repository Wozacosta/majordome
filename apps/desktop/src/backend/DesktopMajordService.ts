import { DesktopBackendBootstrap, type DesktopBackgroundServiceState } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  launchctlPrintPid,
  MAJORD_BOOTSTRAP_FILE,
  MAJORD_DEFAULT_PATH,
  MAJORD_LOG_FILE,
  MAJORD_VERSION_ENV,
  majordLaunchAgentPath,
  majordLaunchctl,
  majordRepairFor,
  renderMajordLaunchAgent,
} from "@t3tools/shared/majord";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import type * as DesktopBackendManager from "./DesktopBackendManager.ts";

const { logInfo, logWarning } = makeComponentLogger("desktop-majord");

/** Environment the bundled server needs from the app; the rest of the app's environment stays out. */
const FORWARDED_ENV_NAMES = ["T3CODE_CLI_PATH", "T3CODE_DESKTOP_HOST_SCOPE"] as const;

export class DesktopMajordServiceError extends Schema.TaggedError<DesktopMajordServiceError>()(
  "DesktopMajordServiceError",
  { step: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return `Could not set up Majordome's background service while ${this.step}.`;
  }
}

const decodeBootstrap = Schema.decodeUnknownOption(Schema.fromJsonString(DesktopBackendBootstrap));
const encodeBootstrap = Schema.encodeEffect(Schema.fromJsonString(DesktopBackendBootstrap));
const decodeRuntime = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ pid: Schema.Int, startedAt: Schema.String })),
);

/**
 * The bootstrap the window's own backend gets, as the service can take it: no file descriptors
 * (launchd passes none), and the secret instead of a one-time token, so later windows can sign in.
 * The token is empty but present, which keeps the server restarting itself as under the app.
 */
const serviceBootstrapOf = (bootstrap: DesktopBackendBootstrap): DesktopBackendBootstrap => ({
  mode: bootstrap.mode,
  noBrowser: bootstrap.noBrowser,
  port: bootstrap.port,
  ...(bootstrap.t3Home === undefined ? {} : { t3Home: bootstrap.t3Home }),
  host: bootstrap.host,
  desktopBootstrapToken: "",
  ...(bootstrap.desktopBootstrapSecret === undefined
    ? {}
    : { desktopBootstrapSecret: bootstrap.desktopBootstrapSecret }),
  tailscaleServeEnabled: bootstrap.tailscaleServeEnabled,
  tailscaleServePort: bootstrap.tailscaleServePort,
  ...(bootstrap.otlpTracesUrl === undefined ? {} : { otlpTracesUrl: bootstrap.otlpTracesUrl }),
  ...(bootstrap.otlpMetricsUrl === undefined ? {} : { otlpMetricsUrl: bootstrap.otlpMetricsUrl }),
  ...(bootstrap.otlpLogsUrl === undefined ? {} : { otlpLogsUrl: bootstrap.otlpLogsUrl }),
  ...(bootstrap.resourceMonitorPath === undefined
    ? {}
    : { resourceMonitorPath: bootstrap.resourceMonitorPath }),
});

/** The window's backend arguments with the bootstrap read from stdin, where launchd puts the file. */
const serviceArgumentsOf = (args: ReadonlyArray<string>): ReadonlyArray<string> =>
  args.map((argument, index) => (args[index - 1] === "--bootstrap-fd" ? "0" : argument));

export class DesktopMajordService extends Context.Service<
  DesktopMajordService,
  {
    /** Packaged macOS builds only: a dev build must never become a login item. */
    readonly supported: boolean;
    /**
     * Whether this app runs its server through majord: when it is installed, and on first launch,
     * where it is on by default. Turning it off keeps the bootstrap, which records the choice.
     */
    readonly wanted: Effect.Effect<boolean>;
    /** The settings the service last ran with, whose port and secret a window reuses. */
    readonly savedBootstrap: Effect.Effect<Option.Option<DesktopBackendBootstrap>>;
    /**
     * Makes the installed agent run this app's server with `config`, repairing one left by a
     * moved or older app. Without `start`, only writes it; launchd starts it at the next login.
     */
    readonly ensure: (
      config: DesktopBackendManager.DesktopBackendStartConfig,
      options: { readonly start: boolean },
    ) => Effect.Effect<void, DesktopMajordServiceError>;
    /** Stops it until the next login or the next time Majordome opens. */
    readonly stop: Effect.Effect<void>;
    readonly uninstall: Effect.Effect<void, DesktopMajordServiceError>;
    readonly state: Effect.Effect<DesktopBackgroundServiceState>;
  }
>()("@t3tools/desktop/backend/DesktopMajordService") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const uid = yield* HostProcess.UserId;
  const { path } = environment;
  const supported =
    environment.isPackaged && environment.platform === "darwin" && uid !== undefined;
  const launchctl = majordLaunchctl(uid ?? 0);
  const plistPath = majordLaunchAgentPath(environment.homeDirectory);
  const bootstrapPath = path.join(environment.stateDir, MAJORD_BOOTSTRAP_FILE);
  const logPath = path.join(environment.logDir, MAJORD_LOG_FILE);

  const run = (args: ReadonlyArray<string>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make("launchctl", [...args], { stdin: "ignore", stderr: "ignore" }),
        );
        const [stdout, code] = yield* Effect.all(
          [handle.stdout.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
          { concurrency: "unbounded" },
        );
        return { code: Number(code), stdout };
      }),
    );
  const runStep = (step: string, args: ReadonlyArray<string>) =>
    run(args).pipe(
      Effect.mapError((cause) => new DesktopMajordServiceError({ step, cause })),
      Effect.filterOrFail(
        (result) => result.code === 0,
        (result) =>
          new DesktopMajordServiceError({
            step,
            cause: new Error(`launchctl exited ${result.code}`),
          }),
      ),
    );
  const runningPid = run(launchctl.print).pipe(
    Effect.map((result) => (result.code === 0 ? launchctlPrintPid(result.stdout) : undefined)),
    Effect.orElseSucceed(() => undefined),
  );
  const loaded = run(launchctl.print).pipe(
    Effect.map((result) => result.code === 0),
    Effect.orElseSucceed(() => false),
  );
  const readOptional = (filePath: string) => fs.readFileString(filePath).pipe(Effect.option);
  const installed = fs.exists(plistPath).pipe(Effect.orElseSucceed(() => false));

  const savedBootstrap = readOptional(bootstrapPath).pipe(
    Effect.map(Option.flatMap((text) => decodeBootstrap(text.trim()))),
  );

  const wanted = Effect.gen(function* () {
    if (!supported) return false;
    if (yield* installed) return true;
    return !(yield* fs.exists(bootstrapPath).pipe(Effect.orElseSucceed(() => true)));
  });

  const desiredFiles = Effect.fn("DesktopMajordService.desiredFiles")(function* (
    config: DesktopBackendManager.DesktopBackendStartConfig,
  ) {
    const environmentVariables: Record<string, string> = {
      ELECTRON_RUN_AS_NODE: "1",
      T3CODE_HOME: environment.baseDir,
      PATH: MAJORD_DEFAULT_PATH,
      [MAJORD_VERSION_ENV]: environment.appVersion,
    };
    for (const name of FORWARDED_ENV_NAMES) {
      const value = config.env[name];
      if (value !== undefined) environmentVariables[name] = value;
    }
    const plist = renderMajordLaunchAgent({
      programArguments: [config.executablePath, ...serviceArgumentsOf(config.args)],
      environment: environmentVariables,
      workingDirectory: config.cwd,
      bootstrapPath,
      logPath,
    });
    const bootstrap = `${yield* encodeBootstrap(serviceBootstrapOf(config.bootstrap))}\n`;
    return { plist, bootstrap };
  });

  const ensure: DesktopMajordService["Service"]["ensure"] = Effect.fn(
    "DesktopMajordService.ensure",
  )(
    function* (config, options) {
      const desired = yield* desiredFiles(config).pipe(
        Effect.mapError(
          (cause) => new DesktopMajordServiceError({ step: "writing its settings", cause }),
        ),
      );
      const [plist, bootstrap, isLoaded] = yield* Effect.all([
        readOptional(plistPath),
        readOptional(bootstrapPath),
        loaded,
      ]);
      const repair = majordRepairFor({
        installed: {
          ...(Option.isSome(plist) ? { plist: plist.value } : {}),
          ...(Option.isSome(bootstrap) ? { bootstrap: bootstrap.value } : {}),
        },
        desired,
        loaded: isLoaded,
      });
      if (repair === "reload") {
        yield* logInfo("writing the background service", { plistPath, loaded: isLoaded });
        yield* Effect.gen(function* () {
          yield* fs.makeDirectory(path.dirname(bootstrapPath), { recursive: true });
          yield* fs.makeDirectory(environment.logDir, { recursive: true });
          yield* fs.writeFileString(bootstrapPath, desired.bootstrap, { mode: 0o600 });
          yield* fs.chmod(bootstrapPath, 0o600);
          yield* fs.makeDirectory(path.dirname(plistPath), { recursive: true });
          yield* fs.writeFileString(plistPath, desired.plist);
        }).pipe(
          Effect.mapError(
            (cause) => new DesktopMajordServiceError({ step: "writing its settings", cause }),
          ),
        );
        if (isLoaded) yield* run(launchctl.stop).pipe(Effect.ignore);
      }
      if (!options.start || repair === "none") return;
      yield* run(launchctl.enable).pipe(Effect.ignore);
      yield* runStep("starting it", launchctl.start(plistPath));
    },
    Effect.tapError((error) => logWarning(error.message, { cause: error.cause })),
  );

  const stop = run(launchctl.stop).pipe(
    Effect.ignore,
    Effect.withSpan("DesktopMajordService.stop"),
  );

  const uninstall = Effect.gen(function* () {
    yield* stop;
    yield* fs
      .remove(plistPath, { force: true })
      .pipe(
        Effect.mapError((cause) => new DesktopMajordServiceError({ step: "removing it", cause })),
      );
  }).pipe(Effect.withSpan("DesktopMajordService.uninstall"));

  const state = Effect.gen(function* () {
    if (!supported) {
      return {
        supported: false,
        enabled: false,
        running: false,
        runningSince: null,
        logPath: null,
      };
    }
    const [enabled, pid, runtime] = yield* Effect.all([
      installed,
      runningPid,
      readOptional(path.join(environment.stateDir, "server-runtime.json")),
    ]);
    const owner = Option.flatMap(runtime, decodeRuntime);
    const runningSince =
      pid === undefined
        ? null
        : Option.isSome(owner) && owner.value.pid === pid
          ? owner.value.startedAt
          : null;
    return { supported: true, enabled, running: pid !== undefined, runningSince, logPath };
  }).pipe(Effect.withSpan("DesktopMajordService.state"));

  return DesktopMajordService.of({
    supported,
    wanted,
    savedBootstrap,
    ensure,
    stop,
    uninstall,
    state,
  });
});

export const layer = Layer.effect(DesktopMajordService, make);

/** A machine without the service, as dev builds and other platforms are. */
export const layerTest = (overrides: Partial<DesktopMajordService["Service"]> = {}) =>
  Layer.succeed(DesktopMajordService, {
    supported: false,
    wanted: Effect.succeed(false),
    savedBootstrap: Effect.succeedNone,
    ensure: Effect.fn("DesktopMajordService.layerTest.ensure")(function* () {}),
    stop: Effect.void,
    uninstall: Effect.void,
    state: Effect.succeed({
      supported: false,
      enabled: false,
      running: false,
      runningSince: null,
      logPath: null,
    }),
    ...overrides,
  });
