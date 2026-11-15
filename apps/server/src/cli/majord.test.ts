import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { majordLaunchAgentProgram } from "@t3tools/shared/majord";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { ChildProcessSpawner } from "effect/process";

import * as ProcessRunner from "../processRunner.ts";
import { installMajord, majordStatus, uninstallMajord, type MajordPaths } from "./majord.ts";

const APP = "/Applications/Majordome.app/Contents/MacOS/Majordome";
const ENTRY = "/Applications/Majordome.app/Contents/Resources/app.asar/apps/server/dist/bin.mjs";

/** A launchd that knows one job, running as pid 4242 while loaded. */
const fakeLaunchd = () => {
  const calls: Array<string> = [];
  let loaded = false;
  const layer = Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (input) =>
      Effect.sync(() => {
        const verb = input.args[0] ?? "";
        calls.push(verb);
        if (verb === "bootout") loaded = false;
        if (verb === "bootstrap") loaded = true;
        const ok = verb !== "print" || loaded;
        return {
          stdout: verb === "print" && loaded ? "state = running\n\tpid = 4242\n" : "",
          stderr: "",
          code: ChildProcessSpawner.ExitCode(ok ? 0 : 113),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  });
  return { calls, layer };
};

const withHome = <A, E>(
  run: (input: {
    readonly paths: MajordPaths;
    readonly launchd: ReturnType<typeof fakeLaunchd>;
  }) => Effect.Effect<
    A,
    E,
    FileSystem.FileSystem | Path.Path | SecureRandom.SecureRandom | ProcessRunner.ProcessRunner
  >,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-cli-majord-" });
    const paths: MajordPaths = {
      baseDir: `${home}/.majordome`,
      stateDir: `${home}/.majordome/userdata`,
      logsDir: `${home}/.majordome/userdata/logs`,
      homeDirectory: home,
    };
    const launchd = fakeLaunchd();
    return yield* run({ paths, launchd }).pipe(
      Effect.provide(launchd.layer),
      Effect.provideService(HostProcess.UserId, 501),
      Effect.provideService(HostProcess.ExecutablePath, APP),
      Effect.provideService(HostProcess.IsExecutable, false),
      Effect.provideService(HostProcess.Arguments, [APP, ENTRY, "service", "install"]),
      Effect.provideService(HostProcess.Environment, {
        ELECTRON_RUN_AS_NODE: "1",
        T3CODE_CLI_PATH: `${home}/.majordome/bin/majord`,
      }),
    );
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const plistPath = (paths: MajordPaths) =>
  `${paths.homeDirectory}/Library/LaunchAgents/io.github.wozacosta.majordome.service.plist`;
const bootstrapPath = (paths: MajordPaths) => `${paths.stateDir}/majord-bootstrap.json`;

describe("majord service", () => {
  it.effect("installs the agent running the app's bundled server, with a fresh secret", () =>
    withHome(({ paths, launchd }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const result = yield* installMajord(paths);

        assert.isTrue(result.changed);
        assert.equal(result.logPath, `${paths.logsDir}/majord.log`);
        const plist = yield* fs.readFileString(plistPath(paths));
        assert.equal(majordLaunchAgentProgram(plist), APP);
        assert.include(plist, `<string>${ENTRY}</string>`);
        assert.include(plist, "<key>ELECTRON_RUN_AS_NODE</key>");
        assert.include(plist, `<key>T3CODE_HOME</key>\n    <string>${paths.baseDir}</string>`);
        const bootstrap = JSON.parse(yield* fs.readFileString(bootstrapPath(paths)));
        assert.equal(bootstrap.mode, "desktop");
        assert.equal(bootstrap.port, 3773);
        assert.equal(bootstrap.host, "127.0.0.1");
        assert.match(bootstrap.desktopBootstrapSecret, /^[0-9a-f]{64}$/);
        assert.equal((yield* fs.stat(bootstrapPath(paths))).mode & 0o777, 0o600);
        assert.deepEqual(launchd.calls, ["print", "enable", "bootstrap"]);

        const status = yield* majordStatus(paths);
        assert.isTrue(status.installed);
        assert.equal(status.pid, 4242);
      }),
    ),
  );

  it.effect("keeps the port and secret the app chose, and does nothing when already running", () =>
    withHome(({ paths, launchd }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(paths.stateDir, { recursive: true });
        yield* fs.writeFileString(
          bootstrapPath(paths),
          `${JSON.stringify({
            mode: "desktop",
            noBrowser: true,
            port: 3781,
            t3Home: paths.baseDir,
            host: "127.0.0.1",
            desktopBootstrapToken: "",
            desktopBootstrapSecret: "the-app-secret",
            tailscaleServeEnabled: true,
            tailscaleServePort: 443,
          })}\n`,
        );

        yield* installMajord(paths);
        const bootstrap = JSON.parse(yield* fs.readFileString(bootstrapPath(paths)));
        assert.equal(bootstrap.port, 3781);
        assert.equal(bootstrap.desktopBootstrapSecret, "the-app-secret");
        assert.isTrue(bootstrap.tailscaleServeEnabled);

        launchd.calls.length = 0;
        assert.isFalse((yield* installMajord(paths)).changed);
        assert.deepEqual(launchd.calls, ["print"]);
      }),
    ),
  );

  it.effect("uninstall stops and removes it but keeps its settings", () =>
    withHome(({ paths, launchd }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        assert.isFalse(yield* uninstallMajord(paths));
        yield* installMajord(paths);

        assert.isTrue(yield* uninstallMajord(paths));

        assert.isFalse(yield* fs.exists(plistPath(paths)));
        assert.isTrue(yield* fs.exists(bootstrapPath(paths)));
        assert.include(launchd.calls, "bootout");
        assert.isFalse((yield* majordStatus(paths)).installed);
      }),
    ),
  );
});
