// First run: e2e tests of what a new owner meets, on a machine with no Claude and no notes.
// See docs/operations/first-run-tests.md.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { web } from "@e2e-dev/web";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type { E2EConfig } from "e2e";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

const resolved = await Effect.gen(function* () {
  const path = yield* Path.Path;
  const scripts = yield* path.fromFileUrl(new URL(".", import.meta.url));
  const env = yield* HostProcess.Environment;
  return {
    node: yield* HostProcess.ExecutablePath,
    appDir: path.resolve(scripts, ".."),
    // Outside the checkout: notes cannot be started in a folder that is part of a repository.
    home: path.join(env.RUNNER_TEMP ?? env.TMPDIR ?? "/tmp", "majordome-first-run"),
    start: path.join(scripts, "first-run/start.ts"),
  };
}).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);

/** The T3 home of a run, recreated every time. The new owner's HOME is `owner` inside it. */
export const FIRST_RUN_HOME = resolved.home;
const LOOPBACK = "127.0.0.1";

export default {
  tests: "first-run/**/*.e2e.ts",
  output: ".e2e-first-run",
  targets: [
    {
      name: "web",
      engine: web({ viewport: { width: 1280, height: 800 } }),
      app: {
        url: `http://${LOOPBACK}:0`,
        readyUrl: `http://${LOOPBACK}:{port}/.well-known/t3/environment`,
        command: {
          executable: resolved.node,
          args: [resolved.start, FIRST_RUN_HOME, LOOPBACK, "{port}"],
          cwd: resolved.appDir,
          // Set, Claude counts as signed in without the browser page no test can drive.
          inheritEnv: ["CLAUDE_CODE_OAUTH_TOKEN"],
          startupTimeout: 300_000,
          log: ".e2e-first-run/app.log",
        },
      },
    },
  ],
  workers: 1,
  timeout: 600_000,
  assertionTimeout: 15_000,
  video: "on",
  trace: "on",
  reporters: ["list", "markdown"],
} satisfies E2EConfig;
