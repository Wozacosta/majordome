// @effect-diagnostics nodeBuiltinImport:off -- The copy must outlive this app: a scoped child process would end with it.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";

/**
 * Set in a copy opened from Testing. The copy must never touch the background service: launchd
 * knows one per user, whatever HOME says, and the owner's own is it.
 */
export const NEW_OWNER_COPY_ENV = "MAJORDOME_NEW_OWNER_COPY";

const HOME_DIRNAME = "majordome-new-owner-app";
const PID_FILE = "copy.pid";

// Each would point the copy back at the owner's own home, port or dev server.
const NOT_PASSED_ON = ["T3CODE_HOME", "T3CODE_PORT", "ELECTRON_RUN_AS_NODE"];

export class DesktopNewOwnerCopyError extends Schema.TaggedError<DesktopNewOwnerCopyError>()(
  "DesktopNewOwnerCopyError",
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.reason;
  }
}

/** The copy's environment: this app's, with an empty home in place of the owner's. */
export function newOwnerCopyEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): Record<string, string> {
  const passedOn = Object.entries(env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !NOT_PASSED_ON.includes(entry[0]),
  );
  return {
    ...Object.fromEntries(passedOn),
    HOME: home,
    [NEW_OWNER_COPY_ENV]: "1",
    T3CODE_DISABLE_AUTO_UPDATE: "1",
  };
}

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Opens a second Majordome whose home is an empty folder, as on a computer that never had it.
 * While one is open, opening again shows it rather than emptying the home under it.
 */
export const open = Effect.fn("desktop.newOwnerCopy.open")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const { path } = environment;
  if (environment.isDevelopment) {
    return yield* new DesktopNewOwnerCopyError({
      reason:
        "A development build shares its page server with its copy. Use `vp run new-owner` instead.",
    });
  }
  const home = path.join(NodeOS.tmpdir(), HOME_DIRNAME);
  const pidPath = path.join(home, PID_FILE);
  const lastPid = Number(yield* fs.readFileString(pidPath).pipe(Effect.orElseSucceed(() => "")));
  const alreadyOpen = Number.isInteger(lastPid) && lastPid > 0 && isRunning(lastPid);

  yield* Effect.gen(function* () {
    if (!alreadyOpen) {
      yield* fs.remove(home, { recursive: true, force: true });
      yield* fs.makeDirectory(home, { recursive: true });
    }
    const args = yield* HostProcess.Arguments;
    const child = NodeChildProcess.spawn(yield* HostProcess.ExecutablePath, args.slice(1), {
      detached: true,
      stdio: "ignore",
      env: newOwnerCopyEnvironment(yield* HostProcess.Environment, home),
    });
    child.unref();
    // A second launch on a home already open only shows the first and exits: its pid is not the copy's.
    if (!alreadyOpen && child.pid !== undefined) {
      yield* fs.writeFileString(pidPath, String(child.pid));
    }
  }).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopNewOwnerCopyError({
          reason: "The new owner's copy could not be opened.",
          cause,
        }),
    ),
  );
});
