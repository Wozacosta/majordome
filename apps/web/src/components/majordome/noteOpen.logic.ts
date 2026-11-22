import type { EditorId } from "@t3tools/contracts";

import type { RemoteOpenResolution } from "../../remoteOpen";

type NoteEditorId = Exclude<EditorId, "file-manager">;

/** One way to open the file shown on the Notes page outside Majordome. */
export type NoteOpenTarget =
  | `editor:${NoteEditorId}`
  | "obsidian"
  | "default-app"
  | "reveal"
  | "copy-path";

/**
 * What "Open in…" offers for a file, in menu order. Apps can only open a file that is on the
 * computer being used, so a file kept on another computer offers nothing. Editors, the default app
 * and the file manager are started by this computer's server and need its leave; Obsidian is
 * reached by a link and the path is only copied, so neither does.
 */
export function noteOpenTargets(input: {
  readonly where: RemoteOpenResolution;
  readonly canOperate: boolean;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly canReveal: boolean;
  /** The notes folder has `.obsidian`: Obsidian already knows it. */
  readonly hasObsidianFolder: boolean;
}): ReadonlyArray<NoteOpenTarget> {
  if (!input.where.isResolved || input.where.state.mode !== "local-exec") return [];
  const hasFileManager = input.canOperate && input.availableEditors.includes("file-manager");
  const editors = input.canOperate
    ? input.availableEditors.flatMap((editor): ReadonlyArray<NoteOpenTarget> =>
        editor === "file-manager" ? [] : [`editor:${editor}`],
      )
    : [];
  return [
    ...(input.hasObsidianFolder ? (["obsidian"] as const) : []),
    ...editors,
    ...(input.hasObsidianFolder ? [] : (["obsidian"] as const)),
    ...(hasFileManager ? (["default-app"] as const) : []),
    ...(hasFileManager && input.canReveal ? (["reveal"] as const) : []),
    "copy-path",
  ];
}

/** The button's own action: the way used last time when it is still offered, else the first. */
export function mainNoteOpenTarget(
  targets: ReadonlyArray<NoteOpenTarget>,
  lastUsed: string | null,
): NoteOpenTarget | null {
  return targets.find((target) => target === lastUsed) ?? targets[0] ?? null;
}

export function noteOpenEditorId(target: NoteOpenTarget): NoteEditorId | null {
  return target.startsWith("editor:") ? (target.slice("editor:".length) as NoteEditorId) : null;
}

/**
 * Obsidian finds the folder by name, not by path: it may know the same folder under another path,
 * such as a shortcut to it, and then refuses a link that carries the path.
 */
export function obsidianOpenUrl(workspaceRoot: string, path: string): string {
  const folder = workspaceRoot.split(/[\\/]+/).findLast((part) => part !== "") ?? "";
  return `obsidian://open?vault=${encodeURIComponent(folder)}&file=${encodeURIComponent(path)}`;
}
