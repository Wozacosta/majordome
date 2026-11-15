import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { majordLaunchAgentProgram } from "@t3tools/shared/majord";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import type * as DesktopBackendManager from "./DesktopBackendManager.ts";
import * as DesktopMajordService from "./DesktopMajordService.ts";

const APP = "/Applications/Majordome.app/Contents/MacOS/Majordome";
const textEncoder = new TextEncoder();

const processWith = (output: string, exitCode: number) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    stdout: Stream.make(textEncoder.encode(output)),
    stderr: Stream.empty,
    all: Stream.empty,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

/** A launchd that knows one job, running as `pid` while loaded. */
const fakeLaunchd = (initial: { readonly loaded: boolean; readonly pid?: number }) => {
  const calls: Array<string> = [];
  let loaded = initial.loaded;
  const spawner = ChildProcessSpawner.make((command) => {
    if (!ChildProcess.isStandardCommand(command) || command.command !== "launchctl") {
      return Effect.die(`unexpected command ${String(command)}`);
    }
    const verb = String(command.args[0] ?? "");
    calls.push(verb);
    if (verb === "print") {
      return Effect.succeed(
        loaded
          ? processWith(`state = running\n\tpid = ${initial.pid ?? 4242}\n`, 0)
          : processWith("", 113),
      );
    }
    if (verb === "bootout") loaded = false;
    if (verb === "bootstrap") loaded = true;
    return Effect.succeed(processWith("", 0));
  });
  return { calls, spawner };
};

const backendConfig = (
  overrides: Partial<DesktopBackendManager.DesktopBackendStartConfig> = {},
): DesktopBackendManager.DesktopBackendStartConfig => ({
  executablePath: APP,
  entryPath: "/Applications/Majordome.app/Contents/Resources/app.asar/apps/server/dist/bin.mjs",
  cwd: "/Users/alice",
  args: [
    "--require",
    "/Applications/Majordome.app/Contents/Resources/app.asar/apps/desktop/dist-electron/compileCache.cjs",
    "/Applications/Majordome.app/Contents/Resources/app.asar/apps/server/dist/bin.mjs",
    "--bootstrap-fd",
    "3",
  ],
  env: {
    ELECTRON_RUN_AS_NODE: "1",
    T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING: "1",
    T3CODE_CLI_PATH: "/Users/alice/.majordome/bin/t3",
    T3CODE_DESKTOP_HOST_SCOPE: "0123456789abcdef0123456789abcdef",
    SECRET_FROM_THE_APP: "leak",
  },
  extendEnv: true,
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3773,
    t3Home: "/Users/alice/.majordome",
    host: "127.0.0.1",
    desktopBootstrapToken: "one-time",
    desktopBootstrapSecret: "secret",
    shellEnvironmentPrepared: true,
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
    desktopTelemetryFd: 4,
    desktopTelemetryControlFd: 5,
    desktopAppUpdate: true,
    desktopBrowserFd: 6,
    desktopBrowserControlFd: 7,
  },
  bootstrapDelivery: "fd3",
  httpBaseUrl: new URL("http://127.0.0.1:3773"),
  captureOutput: true,
  preflightFailure: Option.none(),
  ...overrides,
});

const withService = <A, E>(
  launchd: ReturnType<typeof fakeLaunchd>,
  run: (input: {
    readonly service: DesktopMajordService.DesktopMajordService["Service"];
    readonly home: string;
  }) => Effect.Effect<A, E, FileSystem.FileSystem>,
  options: { readonly isPackaged?: boolean; readonly executablePath?: string } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-majord-test-" });
    const environment = DesktopEnvironment.layer({
      dirname: "/Applications/Majordome.app/Contents/Resources/app.asar/apps/desktop/dist-electron",
      homeDirectory: home,
      platform: "darwin",
      processArch: "arm64",
      appVersion: "1.2.3",
      appPath: "/Applications/Majordome.app/Contents/Resources/app.asar",
      isPackaged: options.isPackaged ?? true,
      resourcesPath: "/Applications/Majordome.app/Contents/Resources",
      runningUnderArm64Translation: false,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeServices.layer,
          DesktopConfig.layerTest({ T3CODE_HOME: `${home}/.majordome` }),
        ),
      ),
    );
    const service = yield* DesktopMajordService.make.pipe(
      Effect.provide(
        Layer.mergeAll(
          environment,
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, launchd.spawner),
        ),
      ),
      Effect.provideService(HostProcess.UserId, 501),
      Effect.provideService(HostProcess.ExecutablePath, options.executablePath ?? APP),
    );
    return yield* run({ service, home });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const plistPath = (home: string) =>
  `${home}/Library/LaunchAgents/io.github.wozacosta.majordome.service.plist`;
const bootstrapPath = (home: string) => `${home}/.majordome/userdata/majord-bootstrap.json`;

describe("DesktopMajordService", () => {
  it.effect("on first launch installs and starts the service running the app's own server", () => {
    const launchd = fakeLaunchd({ loaded: false });
    return withService(launchd, ({ service, home }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        assert.isTrue(yield* service.wanted);

        yield* service.ensure(backendConfig(), { start: true });

        const plist = yield* fs.readFileString(plistPath(home));
        assert.equal(majordLaunchAgentProgram(plist), APP);
        assert.include(plist, "<string>--bootstrap-fd</string>\n    <string>0</string>");
        assert.include(plist, `<string>${home}/.majordome/userdata/logs/majord.log</string>`);
        assert.include(plist, "<key>MAJORDOME_VERSION</key>\n    <string>1.2.3</string>");
        assert.include(plist, "<key>T3CODE_CLI_PATH</key>");
        assert.notInclude(plist, "SECRET_FROM_THE_APP");
        assert.notInclude(plist, "T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING");

        const bootstrap = JSON.parse(yield* fs.readFileString(bootstrapPath(home)));
        assert.deepEqual(bootstrap, {
          mode: "desktop",
          noBrowser: true,
          port: 3773,
          t3Home: "/Users/alice/.majordome",
          host: "127.0.0.1",
          desktopBootstrapToken: "",
          desktopBootstrapSecret: "secret",
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
        });
        assert.equal((yield* fs.stat(bootstrapPath(home))).mode & 0o777, 0o600);
        assert.deepEqual(launchd.calls, ["print", "enable", "bootstrap"]);

        // The next launch reuses the port and the secret, so its window can sign in.
        const saved = yield* service.savedBootstrap;
        assert.equal(Option.getOrThrow(saved).desktopBootstrapSecret, "secret");
        assert.isTrue(yield* service.wanted);
      }),
    );
  });

  it.effect("leaves a matching running service alone", () => {
    const launchd = fakeLaunchd({ loaded: false });
    return withService(launchd, ({ service }) =>
      Effect.gen(function* () {
        yield* service.ensure(backendConfig(), { start: true });
        launchd.calls.length = 0;

        yield* service.ensure(backendConfig(), { start: true });

        assert.deepEqual(launchd.calls, ["print"]);
      }),
    );
  });

  it.effect("repoints and restarts a service left by a moved app", () => {
    const launchd = fakeLaunchd({ loaded: false });
    return withService(launchd, ({ service, home }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* service.ensure(
          backendConfig({
            executablePath: "/Users/alice/Downloads/Majordome.app/Contents/MacOS/Majordome",
          }),
          { start: true },
        );
        launchd.calls.length = 0;

        yield* service.ensure(backendConfig(), { start: true });

        assert.equal(majordLaunchAgentProgram(yield* fs.readFileString(plistPath(home))), APP);
        assert.deepEqual(launchd.calls, ["print", "bootout", "enable", "bootstrap"]);
      }),
    );
  });

  it.effect("turning it on only writes it; the relaunched app starts it", () => {
    const launchd = fakeLaunchd({ loaded: false });
    return withService(launchd, ({ service, home }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* service.ensure(backendConfig(), { start: false });

        assert.isTrue(yield* fs.exists(plistPath(home)));
        assert.deepEqual(launchd.calls, ["print"]);
      }),
    );
  });

  it.effect("stays off once turned off, keeping the settings for next time", () => {
    const launchd = fakeLaunchd({ loaded: false });
    return withService(launchd, ({ service, home }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* service.ensure(backendConfig(), { start: true });

        yield* service.uninstall;

        assert.isFalse(yield* fs.exists(plistPath(home)));
        assert.isTrue(yield* fs.exists(bootstrapPath(home)));
        assert.isFalse(yield* service.wanted);
        assert.include(launchd.calls, "bootout");
        assert.deepEqual(yield* service.state, {
          supported: true,
          enabled: false,
          running: false,
          runningSince: null,
          logPath: `${home}/.majordome/userdata/logs/majord.log`,
        });
      }),
    );
  });

  it.effect("reports since when the running server started", () => {
    const launchd = fakeLaunchd({ loaded: false, pid: 777 });
    return withService(launchd, ({ service, home }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* service.ensure(backendConfig(), { start: true });
        yield* fs.writeFileString(
          `${home}/.majordome/userdata/server-runtime.json`,
          JSON.stringify({ pid: 777, port: 3773, startedAt: "2026-11-15T08:00:00.000Z" }),
        );

        const state = yield* service.state;
        assert.isTrue(state.enabled);
        assert.isTrue(state.running);
        assert.equal(state.runningSince, "2026-11-15T08:00:00.000Z");

        yield* service.stop;
        assert.deepEqual(
          { ...(yield* service.state), logPath: null },
          { supported: true, enabled: true, running: false, runningSince: null, logPath: null },
        );
      }),
    );
  });

  it.effect.each([
    ["a development build", { isPackaged: false }],
    [
      "an app macOS runs from a temporary copy",
      {
        executablePath:
          "/private/var/folders/x/AppTranslocation/1234/d/Majordome.app/Contents/MacOS/Majordome",
      },
    ],
  ] as const)("is never wanted in %s", ([_name, options]) => {
    const launchd = fakeLaunchd({ loaded: false });
    return withService(
      launchd,
      ({ service }) =>
        Effect.gen(function* () {
          assert.isFalse(service.supported);
          assert.isFalse(yield* service.wanted);
        }),
      options,
    );
  });
});
