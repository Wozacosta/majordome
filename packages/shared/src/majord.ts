/**
 * `majord`, Majordome's always-on server, as a macOS launch agent. It runs the server bundled in
 * the installed app, so the desktop app and the `majord` CLI both write it and must agree on it.
 */

// `.service` keeps it apart from the app's bundle id, so launchd and TCC records never collide.
export const MAJORD_LAUNCHD_LABEL = "io.github.wozacosta.majordome.service";
export const MAJORD_LOG_FILE = "majord.log";
/** The server's startup settings, read from stdin (`--bootstrap-fd 0`): launchd passes no pipes. */
export const MAJORD_BOOTSTRAP_FILE = "majord-bootstrap.json";
/** Set on the agent so a new app version renders a different agent and restarts it. */
export const MAJORD_VERSION_ENV = "MAJORDOME_VERSION";
export const MAJORD_DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

export const majordLaunchAgentPath = (homeDirectory: string): string =>
  `${homeDirectory.replace(/\/+$/, "")}/Library/LaunchAgents/${MAJORD_LAUNCHD_LABEL}.plist`;

export interface MajordLaunchAgent {
  /** The app's executable, run as Node, followed by the bundled server and its flags. */
  readonly programArguments: ReadonlyArray<string>;
  readonly environment: Readonly<Record<string, string>>;
  readonly workingDirectory: string;
  readonly bootstrapPath: string;
  readonly logPath: string;
}

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const unescapeXml = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/**
 * Keys are sorted so the same agent always renders the same text: a changed plist means a moved
 * or updated app, and is what triggers a repair.
 */
export function renderMajordLaunchAgent(agent: MajordLaunchAgent): string {
  const string = (value: string) => `<string>${escapeXml(value)}</string>`;
  const environment = Object.entries(agent.environment).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  // KeepAlive restarts it after a crash; ProcessType Interactive avoids background throttling,
  // which would delay routines.
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  ${string(MAJORD_LAUNCHD_LABEL)}`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    ...agent.programArguments.map((argument) => `    ${string(argument)}`),
    `  </array>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    ...environment.flatMap(([key, value]) => [
      `    <key>${escapeXml(key)}</key>`,
      `    ${string(value)}`,
    ]),
    `  </dict>`,
    `  <key>WorkingDirectory</key>`,
    `  ${string(agent.workingDirectory)}`,
    `  <key>StandardInPath</key>`,
    `  ${string(agent.bootstrapPath)}`,
    `  <key>StandardOutPath</key>`,
    `  ${string(agent.logPath)}`,
    `  <key>StandardErrorPath</key>`,
    `  ${string(agent.logPath)}`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <true/>`,
    `  <key>ThrottleInterval</key>`,
    `  <integer>5</integer>`,
    `  <key>ExitTimeOut</key>`,
    `  <integer>30</integer>`,
    `  <key>ProcessType</key>`,
    `  <string>Interactive</string>`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
}

/** The executable an installed agent starts, to say where it points. */
export function majordLaunchAgentProgram(plist: string): string | undefined {
  const program = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(
    plist,
  )?.[1];
  return program === undefined ? undefined : unescapeXml(program);
}

export type MajordRepair = "none" | "start" | "reload";

/**
 * What it takes to make the installed agent run this app's server. A moved or updated app
 * renders another plist and changed settings another bootstrap; either needs a reload, since a
 * running server keeps the code and settings it started with.
 */
export function majordRepairFor(input: {
  readonly installed: { readonly plist?: string; readonly bootstrap?: string };
  readonly desired: { readonly plist: string; readonly bootstrap: string };
  readonly loaded: boolean;
}): MajordRepair {
  if (
    input.installed.plist !== input.desired.plist ||
    input.installed.bootstrap !== input.desired.bootstrap
  ) {
    return "reload";
  }
  return input.loaded ? "none" : "start";
}

/** `launchctl` arguments for this user's agent. `bootout` fails when it is not loaded. */
export function majordLaunchctl(uid: number) {
  const domain = `gui/${uid}`;
  const target = `${domain}/${MAJORD_LAUNCHD_LABEL}`;
  return {
    print: ["print", target],
    // `--wait` waits through ExitTimeOut, so a following bootstrap does not race the old process.
    stop: ["bootout", "--wait", target],
    // A persisted `launchctl disable` refuses bootstrap.
    enable: ["enable", target],
    start: (plistPath: string) => ["bootstrap", domain, plistPath],
    restart: ["kickstart", "-k", target],
  } as const;
}

/** The running process in `launchctl print` output; absent while launchd waits to restart it. */
export function launchctlPrintPid(output: string): number | undefined {
  const pid = /^\s*pid = (\d+)\s*$/m.exec(output)?.[1];
  return pid === undefined ? undefined : Number(pid);
}
