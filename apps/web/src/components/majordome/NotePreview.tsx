import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type ProjectEntry, ThreadId } from "@t3tools/contracts";
import { setMarkdownTaskChecked } from "@t3tools/shared/markdownTaskList";
import { Link, useNavigate } from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";
import { lazy, type MouseEvent, type ReactNode, Suspense } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { projectEnvironment } from "../../state/projects";
import { FileMarkdownPreview } from "../files/FileMarkdownPreview";
import { FILE_SURFACE_SUBHEADER_CLASS, FileSurfaceLoading } from "../files/fileSurfaceChrome";
import { PreviewImage } from "../files/PreviewImage";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import type { ChatMarkdownContextReference } from "../ChatMarkdown";
import { Spinner } from "../ui/spinner";
import { cn } from "../../lib/utils";
import { type notesLink, noteKind, type NotesVault, vaultLinkTarget } from "./notes.logic";
import { READING_MEASURE_CLASS } from "./paper";
import {
  resolveWikiTarget,
  rewriteWikiLinks,
  taskMarkerOffsetInSource,
  WIKI_LINK_KIND,
  wikiLinkTargets,
  wikiSearchName,
} from "./wikiLinks.logic";

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

type NoteLink = (path: string) => ReturnType<typeof notesLink>;

/**
 * A note reads as a page: a comfortable measure, larger text and clear headings. The sizes are
 * marked important because the markdown stylesheet sets its headings outside Tailwind's layers.
 */
const NOTE_READING_CLASS = cn(
  READING_MEASURE_CLASS,
  "mx-auto px-5 py-8 text-base leading-relaxed sm:px-8",
  "[&_:is(h1,h2,h3)]:tracking-tight",
  "[&_h1]:text-3xl! [&_h2]:mt-8! [&_h2]:text-2xl! [&_h3]:mt-6! [&_h3]:text-xl! [&_:is(h4,h5,h6)]:text-base!",
);

/**
 * One note, image or document from the vault, shown as it reads; nothing here edits it. A new
 * `revision` (the vault changed on disk) reads a note or text file again.
 */
export function NotePreview({
  vault,
  path,
  revision,
  showTitle,
  noteLink,
}: {
  readonly vault: NotesVault;
  readonly path: string;
  readonly revision: string | null;
  readonly showTitle: boolean;
  readonly noteLink: NoteLink;
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
        <MarkdownNote vault={vault} path={path} revision={revision} noteLink={noteLink} />
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

/** Each wiki link name's vault search, keyed by `JSON.stringify([env, root, names])`. */
const wikiSearchesAtom = Atom.family((key: string) => {
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
  ).pipe(Atom.withLabel(`majordome:notes-wiki-searches:${key}`));
});

function MarkdownNote({
  vault,
  path,
  revision,
  noteLink,
}: {
  readonly vault: NotesVault;
  readonly path: string;
  readonly revision: string | null;
  readonly noteLink: NoteLink;
}) {
  const file = useProjectFileQuery(vault.environmentId, vault.workspaceRoot, path, true, revision);
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
    <div className="min-h-0 flex-1 overflow-auto">
      <NoteMarkdown
        vault={vault}
        path={path}
        text={file.data.contents}
        noteLink={noteLink}
        className={NOTE_READING_CLASS}
      />
    </div>
  );
}

/** A note's Markdown as it reads, with its wiki links and links to other notes resolved in the vault. */
export function NoteMarkdown({
  vault,
  path,
  text,
  noteLink,
  className,
  onTextChange,
}: {
  readonly vault: NotesVault;
  readonly path: string;
  readonly text: string;
  readonly noteLink: NoteLink;
  readonly className?: string;
  /** Given the whole note with one checkbox ticked or unticked; without it the boxes are read-only. */
  readonly onTextChange?: (text: string) => void;
}) {
  const navigate = useNavigate();
  const targets = wikiLinkTargets(text);
  const names = [...new Set(targets.map(wikiSearchName))];
  const searches = useAtomValue(
    wikiSearchesAtom(JSON.stringify([vault.environmentId, vault.workspaceRoot, names])),
  );
  const foundByName = new Map<string, ReadonlyArray<ProjectEntry>>(
    names.flatMap((name, index) => {
      const found = searches[index];
      return found ? [[name, found.entries] as const] : [];
    }),
  );
  // Undefined while the name's search is still out.
  const resolve = (target: string) => {
    const entries = foundByName.get(wikiSearchName(target));
    return entries === undefined ? undefined : resolveWikiTarget(target, entries);
  };
  const rendered = rewriteWikiLinks(text, (target) => {
    const found = resolve(target);
    return typeof found === "string" ? absoluteVaultPath(vault, found) : found;
  });

  const renderWikiLink = ({ kind, contextId, label }: ChatMarkdownContextReference) => {
    const target = kind === WIKI_LINK_KIND ? targets[Number(contextId)] : undefined;
    const found = target === undefined ? undefined : resolve(target);
    if (typeof found === "string") return <Link {...noteLink(found)}>{label}</Link>;
    if (found === null) {
      return (
        <span className="text-muted-foreground underline decoration-dashed underline-offset-2">
          {label}
        </span>
      );
    }
    return <span>{label}</span>;
  };

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
    void navigate(noteLink(target));
  };

  return (
    <div onClickCapture={onClickCapture}>
      <FileMarkdownPreview
        cwd={vault.workspaceRoot}
        relativePath={path}
        text={rendered}
        threadRef={scopeThreadRef(vault.environmentId, NOTES_THREAD_ID)}
        workspaceMutationId={null}
        renderContextReference={renderWikiLink}
        {...(className === undefined ? {} : { className })}
        {...(onTextChange === undefined
          ? {}
          : {
              onTaskListChange: ({ markerOffset, checked }) =>
                onTextChange(
                  setMarkdownTaskChecked(
                    text,
                    taskMarkerOffsetInSource(text, rendered, markerOffset),
                    checked,
                  ),
                ),
            })}
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
