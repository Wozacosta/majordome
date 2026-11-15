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
