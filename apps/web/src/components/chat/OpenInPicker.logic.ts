import type { EnvironmentId } from "@t3tools/contracts";

import type { RemoteOpenMode } from "../../remoteOpen";

/**
 * Whether an app on this computer can open a path kept in `environmentId`. A server with no
 * SSH route has none, so its button is left out instead of shown disabled.
 */
export function canOpenInLocalApp(input: {
  readonly environmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly hostEnvironmentId: string | null;
  readonly remoteOpenMode: RemoteOpenMode;
}): boolean {
  return (
    input.environmentId === input.primaryEnvironmentId ||
    input.environmentId === input.hostEnvironmentId ||
    input.remoteOpenMode === "remote-links"
  );
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly hostEnvironmentId: string | null;
  readonly remoteOpenMode: RemoteOpenMode;
}): boolean {
  if (!input.activeProjectName) return false;
  return canOpenInLocalApp({ ...input, environmentId: input.activeThreadEnvironmentId });
}

export type FileManagerAction = "open" | "reveal" | "unavailable";

/**
 * The file manager opens folders and shows files in their folder. A path whose read has not
 * settled may be either, and a file needs the server's reveal support, so both wait.
 */
export function fileManagerActionForPath(input: {
  readonly isFolder: boolean;
  readonly isSettled: boolean;
  readonly canReveal: boolean;
}): FileManagerAction {
  if (input.isFolder) return "open";
  return input.isSettled && input.canReveal ? "reveal" : "unavailable";
}
