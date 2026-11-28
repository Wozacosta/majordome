#!/usr/bin/env node
// The app command of first-run.e2e.config.ts: the dev stack as a new owner's computer has it.
// An empty T3 home, an empty HOME, no Claude on PATH, and no replay agent standing in for it.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NetService from "@t3tools/shared/Net";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { start } from "../scenarios/start-app.ts";

// Mirror of BASE_WEB_PORT in dev-runner.ts.
const BASE_WEB_PORT = 5733;

// Claude opens its sign-in page with these. The run records the address instead of opening it.
const OPEN_SHIM = `#!/bin/sh
printf '%s\\n' "$@" >> "$(dirname "$0")/../opened.txt"
`;

const encodeSettings = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const startFirstRun = Effect.fn("firstRun.start")(function* (input: {
  readonly home: string;
  readonly host: string;
  readonly webPort: string;
  /** Keeps the free replay assistant, for looking at screens rather than testing a first run. */
  readonly replay: boolean;
  /** Shows the copy in this machine's browser, for a person rather than a test. */
  readonly open: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const net = yield* NetService.NetService;
  const node = yield* HostProcess.ExecutablePath;
  const checkout = yield* HostProcess.WorkingDirectory;
  const hostEnvironment = yield* HostProcess.Environment;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const opener = (yield* HostProcess.Platform) === "darwin" ? "/usr/bin/open" : "xdg-open";

  const ownerHome = path.join(input.home, "owner");
  const bin = path.join(input.home, "bin");
  if (yield* fs.exists(input.home)) {
    // What Majordome installs to run Gemini is left read-only, folders included.
    const unlock = yield* spawner.spawn(ChildProcess.make("chmod", ["-R", "u+w", input.home]));
    yield* unlock.exitCode;
  }
  yield* fs.remove(input.home, { recursive: true, force: true });
  yield* fs.makeDirectory(path.join(input.home, "userdata"), { recursive: true });
  yield* fs.makeDirectory(ownerHome);
  yield* fs.makeDirectory(bin);
  for (const command of ["open", "xdg-open"]) {
    yield* fs.writeFileString(path.join(bin, command), OPEN_SHIM);
    yield* fs.chmod(path.join(bin, command), 0o755);
  }
  yield* fs.writeFileString(
    path.join(input.home, "userdata/settings.json"),
    yield* encodeSettings(
      input.replay
        ? { defaultModelSelection: { instanceId: "devReplay", model: "showcase" } }
        : {
            // The one real answer a run asks for goes to the cheapest model.
            defaultModelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
            providerInstances: { devReplay: { driver: "acpRegistry", enabled: false } },
          },
    ),
  );

  // A Claude this machine already has would hide the install the run is about.
  const pathEntries: Array<string> = [];
  for (const entry of (hostEnvironment.PATH ?? "").split(":")) {
    if (entry !== "" && !(yield* fs.exists(path.join(entry, "claude")))) pathEntries.push(entry);
  }
  const origin = `http://${input.host}:${input.webPort}`;
  const scope = yield* Effect.scope;
  const serverPort = String(yield* net.reserveLoopbackPort());
  const token = yield* (yield* SecureRandom.SecureRandom).uuidV4();
  const env = {
    ...hostEnvironment,
    HOME: ownerHome,
    PATH: [bin, ...pathEntries].join(":"),
    // A login shell can put the system `open` ahead of the shim; Claude asks this first.
    BROWSER: path.join(bin, "open"),
    T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "0",
    T3CODE_PORT_OFFSET: String(Number(input.webPort) - BASE_WEB_PORT),
  };
  const devRunner = (mode: string, args: ReadonlyArray<string>) => [
    "scripts/dev-runner.ts",
    mode,
    "--home-dir",
    input.home,
    "--no-seed",
    "--port",
    serverPort,
    "--dev-url",
    origin,
    ...args,
  ];
  const show = (pairingPath: string) =>
    net.hasListenerOnHost(Number(input.webPort), input.host).pipe(
      Effect.filterOrFail((listening) => listening),
      Effect.retry({ schedule: Schedule.spaced("500 millis"), times: 600 }),
      Effect.andThen(spawner.spawn(ChildProcess.make(opener, [`${origin}${pairingPath}`]))),
      Effect.andThen(Console.log(`A new owner's copy is open at ${origin}. Ctrl-C ends it.`)),
      Effect.ignore,
      Scope.provide(scope),
      Effect.forkIn(scope),
    );
  const server = yield* start({
    cwd: checkout,
    command: node,
    args: devRunner("dev:server", []),
    env: {
      ...env,
      T3CODE_DEV_ALLOWED_ORIGINS: origin,
      T3CODE_DEV_AUTH_TOKEN: `${token}${token}`.replaceAll("-", ""),
    },
    onLine: (line) => {
      const url = /pairingUrl:\s*(\S+)/.exec(line)?.[1];
      if (url === undefined) return Console.log(line);
      // The link is a credential: it goes to a file the tests read, never to the log.
      const { pathname, search, hash } = new URL(url);
      const pairingPath = `${pathname}${search}${hash}`;
      return fs
        .writeFileString(path.join(input.home, "pairing-path"), pairingPath)
        .pipe(Effect.ignore, Effect.andThen(input.open ? show(pairingPath) : Effect.void));
    },
  });
  const web = yield* start({
    cwd: checkout,
    command: node,
    args: devRunner("dev:web", ["--", "--host", input.host]),
    env,
    onLine: Console.log,
  });
  return yield* Effect.raceFirst(server.exitCode, web.exitCode);
});

const command = Command.make(
  "first-run-start",
  {
    home: Argument.String("t3-home").pipe(Argument.withDescription("T3 home to recreate.")),
    host: Argument.String("host"),
    webPort: Argument.String("web-port"),
    replay: Flag.Boolean("replay").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Keep the free replay assistant, to look at screens with a chat in them.",
      ),
    ),
    open: Flag.Boolean("open").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Open the copy in this machine's browser once it is up."),
    ),
  },
  (input) =>
    startFirstRun(input).pipe(
      Effect.flatMap((exitCode) =>
        Effect.sync(() => {
          process.exitCode = Number(exitCode) || 1;
        }),
      ),
    ),
);

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide([NodeServices.layer, NodeCrypto.layer, NetService.layer]),
    NodeRuntime.runMain,
  );
}
