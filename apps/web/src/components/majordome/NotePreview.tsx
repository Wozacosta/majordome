import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type ProjectEntry, ThreadId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { lazy, type MouseEvent, type ReactNode, Suspense } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { projectEnvironment } from "../../state/projects";
import { FileMarkdownPreview } from "../files/FileMarkdownPreview";
import { FILE_SURFACE_SUBHEADER_CLASS, FileSurfaceLoading } from "../files/fileSurfaceChrome";
import { PreviewImage } from "../files/PreviewImage";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { Spinner } from "../ui/spinner";
import {
  noteKind,
  type NotesVault,
  pickWikiEmbedPath,
  rewriteWikiImageEmbeds,
  vaultLinkTarget,
  wikiImageEmbeds,
} from "./notes.logic";

const WorkspaceBrowserPreview = lazy(() =>
  import("../files/FilePreviewPanel").then((module) => ({
    default: module.WorkspaceBrowserPreview,
  })),
);
const ReadOnlySourcePreview = lazy(() => import("../files/ReadOnlySourcePreview"));

/**
 * The markdown renderer and file previews take a thread; Notes has none. Relative images resolve
 * to absolute paths in the vault, which the server signs without looking the thread up.
 */
const NOTES_THREAD_ID = ThreadId.make("majordome-notes");

function absoluteVaultPath(vault: NotesVault, path: string): string {
  return `${vault.workspaceRoot.replace(/[\\/]+$/, "")}/${path}`;
}

/**
 * One note, image or document from the vault, shown as it reads; nothing here edits it. A new
 * `revision` (the vault changed on disk) reads a note or text file again.
 */
export function NotePreview({
  vault,
  path,
  revision,
  showTitle,
  onOpenNote,
}: {
  readonly vault: NotesVault;
  readonly path: string;
  readonly revision: string | null;
  readonly showTitle: boolean;
  readonly onOpenNote: (path: string) => void;
}) {
  const kind = noteKind(path);
  const parts = path.split("/");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-note-path={path}>
      {showTitle ? (
        <div className={FILE_SURFACE_SUBHEADER_CLASS}>
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {parts.length > 1 ? `${parts.slice(0, -1).join(" / ")} / ` : null}
            <span className="text-foreground">{parts.at(-1)}</span>
          </p>
        </div>
      ) : null}
      {kind === "markdown" ? (
        <MarkdownNote vault={vault} path={path} revision={revision} onOpenNote={onOpenNote} />
      ) : kind === "image" ? (
        <ImageNote vault={vault} path={path} />
      ) : kind === "pdf" ? (
        <Suspense fallback={<FileSurfaceLoading />}>
          <WorkspaceBrowserPreview
            environmentId={vault.environmentId}
            threadRef={scopeThreadRef(vault.environmentId, NOTES_THREAD_ID)}
            draft
            absolutePath={absoluteVaultPath(vault, path)}
            workspaceRoot={vault.workspaceRoot}
            title={path}
            workspaceMutationId={null}
          />
        </Suspense>
      ) : (
        <OtherFile vault={vault} path={path} revision={revision} />
      )}
    </div>
  );
}

function Centered({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Each bare `![[image.png]]` name's vault search, keyed by `JSON.stringify([env, root, names])`. */
const embedSearchesAtom = Atom.family((key: string) => {
  const [environmentId, cwd, names] = JSON.parse(key) as [
    EnvironmentId,
    string,
    ReadonlyArray<string>,
  ];
  return Atom.make((get) =>
    names.map((name) =>
      AsyncResult.getOrElse(
        get(
          projectEnvironment.searchEntries({
            environmentId,
            input: { cwd, query: name.slice(0, 256), limit: 50, kind: "file" },
          }),
        ),
        () => null,
      ),
    ),
  ).pipe(Atom.withLabel(`majordome:notes-embed-searches:${key}`));
});

function MarkdownNote({
  vault,
  path,
  revision,
  onOpenNote,
}: {
  readonly vault: NotesVault;
  readonly path: string;
  readonly revision: string | null;
  readonly onOpenNote: (path: string) => void;
}) {
  const file = useProjectFileQuery(vault.environmentId, vault.workspaceRoot, path, true, revision);
  const text = file.data?.contents ?? "";
  const bareNames = wikiImageEmbeds(text).filter((name) => !name.includes("/"));
  const searches = useAtomValue(
    embedSearchesAtom(JSON.stringify([vault.environmentId, vault.workspaceRoot, bareNames])),
  );
  const foundByName = new Map<string, ReadonlyArray<ProjectEntry>>(
    bareNames.map((name, index) => [name, searches[index]?.entries ?? []]),
  );
  const rendered = rewriteWikiImageEmbeds(text, (name) => {
    const found = pickWikiEmbedPath(name, foundByName.get(name) ?? []);
    return found === null ? null : absoluteVaultPath(vault, found);
  });

  // Links between notes open here, not in the chat's file panel.
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const anchor = (event.target as Element).closest("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    const target = vaultLinkTarget({ href, workspaceRoot: vault.workspaceRoot, notePath: path });
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenNote(target);
  };

  if (file.data === null) {
    return file.error ? (
      <Centered>{file.error}</Centered>
    ) : (
      <Centered>
        <Spinner size="lg" />
      </Centered>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto" onClickCapture={onClickCapture}>
      <FileMarkdownPreview
        cwd={vault.workspaceRoot}
        relativePath={path}
        text={rendered}
        threadRef={scopeThreadRef(vault.environmentId, NOTES_THREAD_ID)}
        workspaceMutationId={null}
      />
    </div>
  );
}

function ImageNote({ vault, path }: { readonly vault: NotesVault; readonly path: string }) {
  const url = useAssetUrlState(vault.environmentId, {
    _tag: "draft-workspace-file",
    cwd: vault.workspaceRoot,
    path: absoluteVaultPath(vault, path),
  });
  if (url._tag === "Failure") return <Centered>This picture couldn't be loaded.</Centered>;
  if (url._tag !== "Success") return <FileSurfaceLoading />;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PreviewImage key={url.url} src={url.url} name={path.split("/").at(-1) ?? path} />
    </div>
  );
}

function OtherFile({
  vault,
  path,
  revision,
}: {
  readonly vault: NotesVault;
  readonly path: string;
  readonly revision: string | null;
}) {
  const file = useProjectFileQuery(vault.environmentId, vault.workspaceRoot, path, true, revision);
  if (file.readError?.failure === "binary_file") {
    return <Centered>Majordome can't show this kind of file yet.</Centered>;
  }
  if (file.data === null) {
    return file.error ? (
      <Centered>{file.error}</Centered>
    ) : (
      <Centered>
        <Spinner size="lg" />
      </Centered>
    );
  }
  return (
    <Suspense fallback={<FileSurfaceLoading />}>
      <ReadOnlySourcePreview name={path} text={file.data.contents} />
    </Suspense>
  );
}
