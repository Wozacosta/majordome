/** Majordome runs beside T3 Code on the same machine, so it keeps its own home and never opens T3 Code's. */

export const MAJORDOME_HOME_DIRNAME = ".majordome";

const T3_CODE_HOME_DIRNAME = ".t3";

const normalize = (value: string): string => value.replaceAll("\\", "/").replace(/\/+$/, "");

/**
 * True when `baseDir` is a home T3 Code keeps state in: `~/.t3` or its dev home `~/.t3/dev`.
 * Other folders under `~/.t3`, such as projects and worktrees, are fine. Both paths must be absolute.
 */
export function isT3CodeHome(baseDir: string, homeDirectory: string): boolean {
  const t3Home = `${normalize(homeDirectory)}/${T3_CODE_HOME_DIRNAME}`;
  const candidate = normalize(baseDir);
  return candidate === t3Home || candidate === `${t3Home}/dev`;
}

export function t3CodeHomeRefusal(baseDir: string): string {
  return `Majordome will not use ${baseDir}: T3 Code keeps its data there. Unset T3CODE_HOME or pass --home-dir with another folder, such as ~/${MAJORDOME_HOME_DIRNAME}.`;
}

/**
 * Majordome is for notes, not code: its chats are not listed the pull request, issue and
 * worktree tools, and are not told how to use them. Upstream's tests of those turn this off.
 */
export const hidesCodingTools: boolean = true;

/** What a server the owner runs calls itself, set in the image. */
export const OWN_SERVER_NAME = "Your server";
/** What a server Majordome hosts for the owner calls itself. */
export const HOSTED_SERVER_NAME = "Majordome server";

/**
 * The name of a server Majordome hosts, from the variable set when it is created. The app tells
 * a hosted server by this name, never by its address, so a change of host changes nothing.
 */
export function hostedServerName(
  environment: Readonly<Record<string, string | undefined>>,
): string | null {
  const flag = environment.MAJORDOME_HOSTED?.trim().toLowerCase();
  return flag === "1" || flag === "true" ? HOSTED_SERVER_NAME : null;
}

/**
 * What a Majordome server is drawn as: a cloud for one Majordome hosts, a server for one the
 * owner runs. What the machine looks like from inside says the opposite as often as not: a
 * rented server is a virtual machine, and a hosted one does not look like one.
 */
export function majordomeMachineKind<Detected>(input: {
  readonly hosted: boolean;
  /** The name the server gives itself. */
  readonly label: string;
  /** What the machine looks like from inside, when that could be told. */
  readonly detected: Detected;
}): Detected | "cloud" | "server" {
  if (input.hosted) return "cloud";
  return input.label === OWN_SERVER_NAME ? "server" : input.detected;
}

/** What the map button sends: the words a person would type to see what the assistant has. */
export const SHOW_SETUP_REQUEST =
  "Show me a diagram of what you know, what you can do and what you have access to here.";

export const SHOW_SETUP_LABEL = "What your assistant can see and do";
