import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type ProjectEntry, ThreadId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";
import { lazy, type MouseEvent, type ReactNode, Suspense, useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { useOpenLink } from "../../browser/useOpenLink";
import { majordomeEnvironment } from "../../state/majordome";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { FileMarkdownPreview } from "../files/FileMarkdownPreview";
import { PencilIcon } from "lucide-react";
import { FILE_SURFACE_SUBHEADER_CLASS, FileSurfaceLoading } from "../files/fileSurfaceChrome";
import { PreviewImage } from "../files/PreviewImage";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import type { ChatMarkdownContextReference } from "../ChatMarkdown";
import { Spinner } from "../ui/spinner";
import { cn } from "../../lib/utils";
import {
  isEditableNotePath,
  type notesLink,
  noteKind,
  type NotesVault,
  vaultLinkTarget,
} from "./notes.logic";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { NoteSaveProblem, NoteSaveStatus, useNoteEditing } from "./noteEditing";
import { NoteOpenIn } from "./NoteOpenIn";
import { NoteSourceEditor, type NoteSourceLink } from "./NoteSourceEditor";
import { READING_MEASURE_CLASS } from "./paper";
import {
  resolveWikiTarget,
  rewriteWikiLinks,
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
 * One note, image or document from the vault, shown as it reads. With `editable`, a Markdown note
 * is written in place by a device allowed to save it. A new `revision` (the vault changed on disk)
 * reads a note or text file again.
 */
export function NotePreview({
  vault,
  openInVault = vault,
  path,
  revision,
  showTitle,
  editable,
  noteLink,
}: {
  readonly vault: NotesVault;
  /** The copy of the same notes that "Open in…" opens and the path names. */
  readonly openInVault?: NotesVault;
  readonly path: string;
  readonly revision: string | null;
  readonly showTitle: boolean;
  readonly editable: boolean;
  readonly noteLink: NoteLink;
}) {
  const kind = noteKind(path);
  const parts = path.split("/");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-note-path={path}>
      {showTitle ? (
        <div className={FILE_SURFACE_SUBHEADER_CLASS}>
          <Tooltip>
            <TooltipTrigger
              render={<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" />}
            >
              {parts.length > 1 ? `${parts.slice(0, -1).join(" / ")} / ` : null}
              <span className="text-foreground">{parts.at(-1)}</span>
            </TooltipTrigger>
            <TooltipPopup side="bottom">{absoluteVaultPath(openInVault, path)}</TooltipPopup>
          </Tooltip>
          <NoteOpenIn vault={openInVault} absolutePath={absoluteVaultPath(openInVault, path)} />
        </div>
      ) : null}
      {kind === "markdown" ? (
        <MarkdownNote
          // Another note starts as it reads, not in the writing left open on the last one.
          key={path}
          vault={vault}
          path={path}
          revision={revision}
          editable={editable}
          noteLink={noteLink}
        />
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
  editable,
  noteLink,
}: {
  readonly vault: NotesVault;
  readonly path: string;
  readonly revision: string | null;
  readonly editable: boolean;
  readonly noteLink: NoteLink;
}) {
  const file = useProjectFileQuery(vault.environmentId, vault.workspaceRoot, path, true, revision);
  const canSave = useAtomValue(majordomeEnvironment.saveNote.permissionAtom(vault.environmentId));
  const [writing, setWriting] = useState(false);
  if (file.data === null) {
    return file.error ? (
      <Centered>{file.error}</Centered>
    ) : (
      <Centered>
        <Spinner size="lg" />
      </Centered>
    );
  }
  // A note cut short on its way here must never be saved back over the whole one.
  const mayWrite = editable && canSave && isEditableNotePath(path) && !file.data.truncated;
  if (mayWrite && writing) {
    return (
      <EditableNote
        vault={vault}
        path={path}
        disk={file.data.contents}
        onSaved={file.refresh}
        onDone={() => setWriting(false)}
        noteLink={noteLink}
      />
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {mayWrite ? (
        // The note reads as it is rendered, tables and pictures included, until the owner asks to
        // write: a stray key while reading must never change a note.
        <div className="sticky top-0 z-10 flex justify-end px-3 pt-2">
          <Button size="xs" variant="outline" onClick={() => setWriting(true)}>
            <PencilIcon />
            Edit
          </Button>
        </div>
      ) : null}
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

/** A Markdown note written in place: saved as it is typed, like the day's note on Today. */
function EditableNote({
  vault,
  path,
  disk,
  onSaved,
  onDone,
  noteLink,
}: {
  readonly vault: NotesVault;
  readonly path: string;
  readonly disk: string;
  readonly onSaved: () => void;
  /** Back to the note as it reads, once what was typed is saved. */
  readonly onDone: () => void;
  readonly noteLink: NoteLink;
}) {
  const saveNote = useAtomCommand(majordomeEnvironment.saveNote, {
    label: "save note",
    reportFailure: false,
  });
  const editing = useNoteEditing({
    disk,
    save: async (content, base) => {
      const outcome = await saveNote({
        environmentId: vault.environmentId,
        input: { projectId: vault.projectId, path, content, base: base ?? "" },
      });
      // Read again either way: a refused save means the file is not what is shown.
      onSaved();
      return outcome;
    },
  });
  const openLink = useNoteSourceLinkOpener({
    vault,
    path,
    text: editing.view.draft ?? disk,
    noteLink,
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto scrollbar-gutter-both">
        <div className={cn(READING_MEASURE_CLASS, "mx-auto px-5 py-8 sm:px-8")}>
          <NoteSaveProblem editing={editing} className="mb-4" />
          <NoteSourceEditor
            value={disk}
            held={editing.held}
            editable
            placeholder="This note is empty. Click here to write."
            ariaLabel="This note"
            onChange={editing.change}
            onBlur={() => void editing.flush()}
            onOpenLink={openLink}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-border px-5 py-1.5 sm:px-8">
        <NoteSaveStatus view={editing.view} className="min-w-0 flex-1" />
        <Button size="xs" variant="outline" onClick={() => void editing.flush().then(onDone)}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** Opens what a link in a note's source points at: another note here, a web page outside. */
export function useNoteSourceLinkOpener(input: {
  readonly vault: NotesVault;
  readonly path: string;
  readonly text: string;
  readonly noteLink: NoteLink;
}): (link: NoteSourceLink) => void {
  const { vault, path, text, noteLink } = input;
  const navigate = useNavigate();
  const openLink = useOpenLink(null);
  const names = [...new Set(wikiLinkTargets(text).map(wikiSearchName))];
  const searches = useAtomValue(
    wikiSearchesAtom(JSON.stringify([vault.environmentId, vault.workspaceRoot, names])),
  );
  return (link) => {
    if (link.kind === "wiki") {
      const entries = searches[names.indexOf(wikiSearchName(link.target))]?.entries;
      const found = entries === undefined ? undefined : resolveWikiTarget(link.target, entries);
      if (typeof found === "string") void navigate(noteLink(found));
      return;
    }
    const target = vaultLinkTarget({
      href: link.target,
      workspaceRoot: vault.workspaceRoot,
      notePath: path,
    });
    if (target !== null) void navigate(noteLink(target));
    else if (/^https?:/i.test(link.target)) void openLink(link.target).catch(() => undefined);
  };
}

/** A note's Markdown as it reads, with its wiki links and links to other notes resolved in the vault. */
function NoteMarkdown({
  vault,
  path,
  text,
  noteLink,
  className,
}: {
  readonly vault: NotesVault;
  readonly path: string;
  readonly text: string;
  readonly noteLink: NoteLink;
  readonly className?: string;
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
