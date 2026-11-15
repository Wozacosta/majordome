/**
 * The secret scan before anything of the vault is saved or sent: gitleaks, when it is installed.
 * Without it, saving and syncing go ahead unscanned and the backup screen says so.
 */

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";

// A service started by launchd does not get Homebrew's folders on its PATH.
const EXTRA_GITLEAKS_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
// Leaks exit with this code, so a crash (exit 1) is not taken for a clean scan or a hit.
const LEAKS_EXIT_CODE = 3;

export const findGitleaks = Effect.fn("majordome.findGitleaks")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcess.Environment;
  const delimiter = (yield* HostProcess.Platform) === "win32" ? ";" : ":";
  const dirs = [...(environment["PATH"] ?? "").split(delimiter), ...EXTRA_GITLEAKS_DIRS];
  for (const dir of dirs) {
    if (dir.trim() === "") continue;
    const candidate = path.join(dir, "gitleaks");
    if (yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
      return candidate;
    }
  }
  return null;
});

const Findings = Schema.Array(Schema.Struct({ File: Schema.optional(Schema.String) }));
const decodeFindings = Schema.decodeUnknownOption(Schema.fromJsonString(Findings));

export type SecretScanResult =
  | { readonly status: "clean" }
  | { readonly status: "found"; readonly files: ReadonlyArray<string> }
  | { readonly status: "failed" };

/** Scans what is staged, or the commits `logOpts` selects. Findings are redacted. */
export const scanForSecrets = Effect.fn("majordome.scanForSecrets")(function* (input: {
  readonly gitleaks: string;
  readonly cwd: string;
  readonly target: { readonly staged: true } | { readonly logOpts: string };
}) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const result = yield* runner
    .run({
      command: input.gitleaks,
      args: [
        "git",
        "--no-banner",
        "--redact",
        "--log-level",
        "error",
        "--exit-code",
        String(LEAKS_EXIT_CODE),
        "--report-format",
        "json",
        "--report-path",
        "-",
        ...("staged" in input.target ? ["--staged"] : ["--log-opts", input.target.logOpts]),
        ".",
      ],
      cwd: input.cwd,
      timeout: "5 minutes",
    })
    .pipe(Effect.option);
  if (result._tag === "None") return { status: "failed" } as SecretScanResult;
  const { code, stdout } = result.value;
  if (code === 0) return { status: "clean" } as SecretScanResult;
  if (code !== LEAKS_EXIT_CODE) return { status: "failed" } as SecretScanResult;
  const findings = decodeFindings(stdout.trim() === "" ? "[]" : stdout);
  const files =
    findings._tag === "Some"
      ? [...new Set(findings.value.flatMap((finding) => (finding.File ? [finding.File] : [])))]
      : [];
  return { status: "found", files } as SecretScanResult;
});
