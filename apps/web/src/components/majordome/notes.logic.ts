import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/mediaPreview";

import { isMarkdownPreviewFile } from "../files/filePreviewMode";

/**
 * Plumbing a person never opens: dotfiles and dotfolders (`.git`, `.majordome`, `.obsidian`,
 * `.trash`, `.claude`, `.agents`…) and installed packages. Anything below them is hidden too.
 */
export function isHiddenVaultPath(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]/)
    .some((segment) => segment.startsWith(".") || segment === "node_modules");
}

export interface NotesVault {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly brainId?: string | null | undefined;
}

/** The vault the link asks for when it is one, otherwise the first one. */
export function selectNotesVault(
  vaults: ReadonlyArray<NotesVault>,
  requested: {
    readonly projectId?: ProjectId | undefined;
    readonly environmentId?: EnvironmentId | undefined;
  },
): NotesVault | null {
  const match = vaults.find(
    (vault) =>
      vault.projectId === requested.projectId &&
      (requested.environmentId === undefined || vault.environmentId === requested.environmentId),
  );
  return match ?? vaults[0] ?? null;
}

/** Screens that open a note and get a way back from Notes. */
export const NOTES_RETURN_SCREENS = {
  feed: { to: "/feed", label: "Feed" },
  overview: { to: "/settings/overview", label: "Overview" },
} as const;
export type NotesReturnScreen = keyof typeof NOTES_RETURN_SCREENS;

export interface NotesSearch {
  readonly project?: ProjectId;
  readonly environment?: EnvironmentId;
  readonly path?: string;
  readonly from?: NotesReturnScreen;
}

/** A vault-relative path, or undefined when it climbs out of the vault or is plumbing. */
function cleanNotePath(value: string): string | undefined {
  const path = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^(?:\.?\/)+/, "")
    .replace(/\/+$/, "");
  if (path === "" || path.split("/").includes("..") || isHiddenVaultPath(path)) return undefined;
  return path;
}

export function validateNotesSearch(raw: Record<string, unknown>): NotesSearch {
  const path = typeof raw.path === "string" ? cleanNotePath(raw.path) : undefined;
  return {
    ...(typeof raw.project === "string" && raw.project.trim()
      ? { project: ProjectId.make(raw.project.trim()) }
      : {}),
    ...(typeof raw.environment === "string" && raw.environment.trim()
      ? { environment: EnvironmentId.make(raw.environment.trim()) }
      : {}),
    ...(path === undefined ? {} : { path }),
    ...(typeof raw.from === "string" && Object.hasOwn(NOTES_RETURN_SCREENS, raw.from)
      ? { from: raw.from as NotesReturnScreen }
      : {}),
  };
}

/**
 * Where a note opens in Notes, for a `<Link {...notesLink(…)} />` from any screen:
 * `/notes?project=<id>&path=<file>`, with the environment when the project id alone is ambiguous.
 */
export function notesLink(input: {
  readonly projectId: ProjectId;
  readonly environmentId?: EnvironmentId | undefined;
  readonly path?: string | undefined;
  /** The screen the reader came from, which Notes offers a way back to. */
  readonly from?: NotesReturnScreen | undefined;
}): { readonly to: "/notes"; readonly search: NotesSearch } {
  const path = input.path === undefined ? undefined : cleanNotePath(input.path);
  return {
    to: "/notes",
    search: {
      project: input.projectId,
      ...(input.environmentId === undefined ? {} : { environment: input.environmentId }),
      ...(path === undefined ? {} : { path }),
      ...(input.from === undefined ? {} : { from: input.from }),
    },
  };
}

export type NoteKind = "markdown" | "image" | "pdf" | "other";

export function noteKind(path: string): NoteKind {
  if (isMarkdownPreviewFile(path)) return "markdown";
  if (/\.pdf$/i.test(path)) return "pdf";
  if (isWorkspaceImagePreviewPath(path)) return "image";
  return "other";
}

/** The vault file a clicked link points at, or null for web links and files outside the vault. */
export function vaultLinkTarget(input: {
  readonly href: string;
  readonly workspaceRoot: string;
  readonly notePath: string;
}): string | null {
  let href = input.href.trim();
  if (href === "" || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  href = href.replace(/[?#].*$/, "");
  try {
    href = decodeURIComponent(href);
  } catch {
    return null;
  }
  const root = input.workspaceRoot.replace(/[\\/]+$/, "");
  let joined: string;
  if (href.startsWith("/")) {
    if (!href.startsWith(`${root}/`)) return null;
    joined = href.slice(root.length + 1);
  } else {
    const noteDir = input.notePath.split("/").slice(0, -1);
    joined = [...noteDir, href].join("/");
  }
  const segments: Array<string> = [];
  for (const segment of joined.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  const path = segments.join("/");
  return path === "" || isHiddenVaultPath(path) ? null : path;
}
