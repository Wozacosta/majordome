import { DesktopBackendBootstrap } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  launchctlPrintPid,
  MAJORD_BOOTSTRAP_FILE,
  MAJORD_DEFAULT_PATH,
  MAJORD_LOG_FILE,
  MAJORD_VERSION_ENV,
  majordLaunchAgentPath,
  majordLaunchAgentProgram,
  majordLaunchctl,
  majordRepairFor,
  renderMajordLaunchAgent,
} from "@t3tools/shared/majord";
import * as Console from "effect/Console";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { CliError, Command, GlobalFlag } from "effect/cli";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import { resolveEntryPath } from "./invocation.ts";

const MAC_ONLY =
  "majord runs in the background on macOS for now. On a server, run Majordome's container image.";

export class MajordStartError extends Schema.TaggedError<MajordStartError>()("MajordStartError", {
  logPath: Schema.String,
}) {
  override get message(): string {
    return `launchd did not start Majordome. Its log may say why: ${this.logPath}`;
  }

  override get [CliError.userMessage]() {
    return this.message;
  }
}

/** Where this home's agent and its files live. */
export interface MajordPaths {
  readonly baseDir: string;
  readonly stateDir: string;
  readonly logsDir: string;
  readonly homeDirectory: string;
}

const decodeBootstrap = Schema.decodeUnknownOption(Schema.fromJsonString(DesktopBackendBootstrap));
const encodeBootstrap = Schema.encodeEffect(Schema.fromJsonString(DesktopBackendBootstrap));
const decodeRuntime = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ pid: Schema.Int, startedAt: Schema.String })),
);

const filesOf = (path: Path.Path, paths: MajordPaths) => ({
  plistPath: majordLaunchAgentPath(paths.homeDirectory),
  bootstrapPath: path.join(paths.stateDir, MAJORD_BOOTSTRAP_FILE),
  logPath: path.join(paths.logsDir, MAJORD_LOG_FILE),
  runtimePath: path.join(paths.stateDir, "server-runtime.json"),
});

const launchctl = Effect.fn("cli.majord.launchctl")(function* (args: ReadonlyArray<string>) {
  const runner = yield* ProcessRunner.ProcessRunner;
  return yield* runner
    .run({ command: "launchctl", args, timeout: Duration.minutes(2) })
    .pipe(Effect.map((result) => ({ ok: result.code === 0, stdout: result.stdout })));
});

/**
 * Installs and starts the agent the desktop app would write, running the server this CLI belongs
 * to: under the app's `majord` command, the app's own. A home the app already set up keeps its
 * port and secret, so its window still signs in; the app rewrites the agent its way when it opens.
 */
export const installMajord = Effect.fn("cli.majord.install")(function* (paths: MajordPaths) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = filesOf(path, paths);
  const environment = yield* HostProcess.Environment;
  const commands = majordLaunchctl((yield* HostProcess.UserId) ?? 0);

  const saved = Option.flatMap(
    yield* fs.readFileString(files.bootstrapPath).pipe(Effect.option),
    (text) => decodeBootstrap(text.trim()),
  );
  const bootstrap = Option.isSome(saved)
    ? saved.value
    : ({
        mode: "desktop",
        noBrowser: true,
        port: ServerConfig.DEFAULT_PORT,
        t3Home: paths.baseDir,
        host: "127.0.0.1",
        desktopBootstrapToken: "",
        desktopBootstrapSecret: Hex.encode(
          yield* (yield* SecureRandom.SecureRandom).randomBytes(32).pipe(Effect.orDie),
        ),
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      } satisfies DesktopBackendBootstrap);

  const desired = {
    plist: renderMajordLaunchAgent({
      programArguments: [
        yield* HostProcess.ExecutablePath,
        yield* resolveEntryPath,
        "--bootstrap-fd",
        "0",
      ],
      environment: {
        T3CODE_HOME: paths.baseDir,
        PATH: MAJORD_DEFAULT_PATH,
        [MAJORD_VERSION_ENV]: packageJson.version,
        // The app's `majord` command runs its Electron executable as Node.
        ...(environment.ELECTRON_RUN_AS_NODE === "1" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        ...(environment.T3CODE_CLI_PATH ? { T3CODE_CLI_PATH: environment.T3CODE_CLI_PATH } : {}),
      },
      workingDirectory: paths.homeDirectory,
      bootstrapPath: files.bootstrapPath,
      logPath: files.logPath,
    }),
    bootstrap: `${yield* encodeBootstrap(bootstrap)}\n`,
  };
  const loaded = (yield* launchctl(commands.print)).ok;
  const repair = majordRepairFor({
    installed: {
      ...Option.match(yield* fs.readFileString(files.plistPath).pipe(Effect.option), {
        onNone: () => ({}),
        onSome: (plist) => ({ plist }),
      }),
      ...Option.match(yield* fs.readFileString(files.bootstrapPath).pipe(Effect.option), {
        onNone: () => ({}),
        onSome: (text) => ({ bootstrap: text }),
      }),
    },
    desired,
    loaded,
  });
  if (repair === "reload") {
    yield* fs.makeDirectory(paths.stateDir, { recursive: true });
    yield* fs.makeDirectory(paths.logsDir, { recursive: true });
    yield* fs.writeFileString(files.bootstrapPath, desired.bootstrap, { mode: 0o600 });
    yield* fs.chmod(files.bootstrapPath, 0o600);
    yield* fs.makeDirectory(path.dirname(files.plistPath), { recursive: true });
    yield* fs.writeFileString(files.plistPath, desired.plist);
    if (loaded) yield* launchctl(commands.stop);
  }
  if (repair !== "none") {
    yield* launchctl(commands.enable);
    const started = yield* launchctl(commands.start(files.plistPath));
    if (!started.ok) return yield* new MajordStartError({ logPath: files.logPath });
  }
  return { changed: repair !== "none", logPath: files.logPath };
});

/** Stops the agent and removes it. The settings stay, so turning it on again keeps them. */
export const uninstallMajord = Effect.fn("cli.majord.uninstall")(function* (paths: MajordPaths) {
  const fs = yield* FileSystem.FileSystem;
  const { plistPath } = filesOf(yield* Path.Path, paths);
  if (!(yield* fs.exists(plistPath))) return false;
  yield* launchctl(majordLaunchctl((yield* HostProcess.UserId) ?? 0).stop);
  yield* fs.remove(plistPath, { force: true });
  return true;
});

export const majordStatus = Effect.fn("cli.majord.status")(function* (paths: MajordPaths) {
  const fs = yield* FileSystem.FileSystem;
  const files = filesOf(yield* Path.Path, paths);
  const plist = yield* fs.readFileString(files.plistPath).pipe(Effect.option);
  if (Option.isNone(plist)) return { installed: false as const, logPath: files.logPath };
  const printed = yield* launchctl(majordLaunchctl((yield* HostProcess.UserId) ?? 0).print);
  const pid = printed.ok ? launchctlPrintPid(printed.stdout) : undefined;
  const runtime = Option.flatMap(
    yield* fs.readFileString(files.runtimePath).pipe(Effect.option),
    decodeRuntime,
  );
  return {
    installed: true as const,
    program: majordLaunchAgentProgram(plist.value),
    pid,
    since:
      pid !== undefined && Option.isSome(runtime) && runtime.value.pid === pid
        ? runtime.value.startedAt
        : undefined,
    logPath: files.logPath,
  };
});

const formatMajordStatus = (status: Effect.Success<ReturnType<typeof majordStatus>>) => {
  if (!status.installed) {
    return [
      "majord: not running in the background",
      "  Turn on “Keep Majordome running when the window is closed” in the app, or run `majord service install`.",
    ].join("\n");
  }
  return [
    status.pid === undefined
      ? "majord: stopped"
      : `majord: running${status.since === undefined ? "" : ` since ${status.since}`} (pid ${status.pid})`,
    ...(status.program === undefined ? [] : [`  Runs: ${status.program}`]),
    `  Log: ${status.logPath}`,
    ...(status.pid === undefined
      ? [
          "  It starts at your next login, when you open Majordome, or with `majord service restart`.",
        ]
      : []),
  ].join("\n");
};

const runForHome = Effect.fn("cli.majord.runForHome")(function* <A, E, R>(
  flags: { readonly baseDir: Parameters<typeof resolveCliAuthConfig>[0]["baseDir"] },
  run: (paths: MajordPaths) => Effect.Effect<A, E, R>,
) {
  if ((yield* HostProcess.Platform) !== "darwin") return yield* Console.log(MAC_ONLY);
  const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel, {
    quietLogs: true,
  });
  return yield* run({
    baseDir: config.baseDir,
    stateDir: config.stateDir,
    logsDir: config.logsDir,
    homeDirectory: yield* HostProcess.HomeDirectory,
  }).pipe(Effect.provide(ProcessRunner.layer));
});

export const majordStatusCommand = Command.make("status", projectLocationFlags).pipe(
  Command.withDescription("Show whether Majordome runs in the background, and where it logs."),
  Command.withHandler((flags) =>
    runForHome(flags, (paths) =>
      majordStatus(paths).pipe(Effect.flatMap((status) => Console.log(formatMajordStatus(status)))),
    ),
  ),
);

const installCommand = Command.make("install", projectLocationFlags).pipe(
  Command.withDescription("Run Majordome in the background now and at every login."),
  Command.withHandler((flags) =>
    runForHome(flags, (paths) =>
      installMajord(paths).pipe(
        Effect.flatMap((result) =>
          Console.log(
            `${result.changed ? "Majordome now runs in the background." : "Majordome already runs in the background."}\nLog: ${result.logPath}`,
          ),
        ),
      ),
    ),
  ),
);

const uninstallCommand = Command.make("uninstall", projectLocationFlags).pipe(
  Command.withDescription("Stop running Majordome in the background. Your notes are kept."),
  Command.withHandler((flags) =>
    runForHome(flags, (paths) =>
      uninstallMajord(paths).pipe(
        Effect.flatMap((removed) =>
          Console.log(
            removed
              ? "Majordome no longer runs in the background. It runs while its window is open."
              : "Majordome was not running in the background.",
          ),
        ),
      ),
    ),
  ),
);

const restartCommand = Command.make("restart", projectLocationFlags).pipe(
  Command.withDescription("Restart Majordome in the background."),
  Command.withHandler((flags) =>
    runForHome(flags, (paths) =>
      Effect.gen(function* () {
        const status = yield* majordStatus(paths);
        if (!status.installed) return yield* Console.log(formatMajordStatus(status));
        const commands = majordLaunchctl((yield* HostProcess.UserId) ?? 0);
        // kickstart only restarts a loaded job; one stopped by "Quit completely" needs a bootstrap.
        if ((yield* launchctl(commands.restart)).ok) {
          return yield* Console.log("Restarted Majordome in the background.");
        }
        yield* launchctl(commands.start(majordLaunchAgentPath(paths.homeDirectory)));
        return yield* Console.log("Started Majordome in the background.");
      }),
    ),
  ),
);

export const majordServiceCommand = Command.make("service").pipe(
  Command.withDescription("Keep Majordome running in the background, as the app's setting does."),
  Command.withSubcommands([installCommand, uninstallCommand, restartCommand, majordStatusCommand]),
);
