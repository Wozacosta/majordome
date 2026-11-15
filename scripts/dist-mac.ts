// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
// Builds a Majordome DMG on this Mac: signed with the keychain's Developer ID Application identity
// when there is one, ad hoc otherwise. Extra arguments go to build-desktop-artifact.ts.
import * as NodeChildProcess from "node:child_process";

const identities = NodeChildProcess.execFileSync(
  "security",
  ["find-identity", "-v", "-p", "codesigning"],
  { encoding: "utf8" },
);
const signed = identities.includes('"Developer ID Application:');
console.log(
  signed
    ? "Signing with the Developer ID Application identity in your keychain."
    : "No Developer ID Application identity in your keychain: signing ad hoc.",
);

// Only a Developer ID build can install updates, so only it gets the release feed.
const env = signed
  ? {
      ...process.env,
      T3CODE_DESKTOP_UPDATE_REPOSITORY:
        process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY ?? "Wozacosta/majordome",
    }
  : process.env;
const args = [
  "scripts/build-desktop-artifact.ts",
  "--platform",
  "mac",
  "--target",
  "dmg",
  ...(signed ? ["--signed"] : []),
  ...process.argv.slice(2),
];
const result = NodeChildProcess.spawnSync(process.execPath, args, { stdio: "inherit", env });
process.exit(result.status ?? 1);
