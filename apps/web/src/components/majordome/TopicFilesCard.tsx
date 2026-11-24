import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { DownloadIcon, FileIcon, LockIcon, XIcon } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { assetEnvironment } from "../../state/assets";
import { majordomeEnvironment } from "../../state/majordome";
import { readPreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "../chat/threadDetailsPanelStyles";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { projectEnvironment } from "../../state/projects";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isUnknownRequest } from "./connections.logic";
import { notesLink } from "./notes.logic";
import { privateDocumentFailureMessage } from "./privateDocuments.logic";
import {
  moreFilesLine,
  privateDocumentNameFor,
  topicFileDate,
  topicFilePreviewable,
  isNoteFileName,
  topicFileProblem,
  type TopicFileRow,
  topicFileRows,
} from "./topicFiles.logic";
import type { VaultTopic } from "./topics.logic";
import { usePendingUpload } from "./usePendingUpload";

const NOT_CONNECTED = "Majordome isn't connected to this computer right now.";

const failureMessage = (result: AtomCommandResult<unknown, unknown>) => {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : String(error);
};

// As chat attachments are downloaded: the server answers with the file to save.
function saveFromUrl(url: string, name: string) {
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
}

const droppedFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

/**
 * The documents kept with a topic, in its chat's panel. `workspaceRoot` is the notes folder on
 * the chat's computer, null until it is known; a file is shown in a tab from there.
 */
const NO_NOTES = Atom.make(null).pipe(Atom.withLabel("majordome:topic-files:no-notes"));

export function TopicFiles({
  environmentId,
  projectId,
  topic,
  threadId,
  workspaceRoot,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly topic: VaultTopic;
  /** The chat this panel sits beside: its folder list opens next to it. */
  readonly threadId: ThreadId;
  readonly workspaceRoot: string | null;
}) {
  const navigate = useNavigate();
  const where = { projectId, topicId: topic.id };
  const result = useAtomValue(majordomeEnvironment.topicFiles({ environmentId, input: where }));
  const privateResult = useAtomValue(
    majordomeEnvironment.privateDocuments({ environmentId, input: {} }),
  );
  const canChange = useAtomValue(majordomeEnvironment.addTopicFile.permissionAtom(environmentId));
  const mayUsePrivate = useAtomValue(
    majordomeEnvironment.addPrivateDocument.permissionAtom(environmentId),
  );
  const sendFile = usePendingUpload(environmentId, "upload topic file");
  const addTopicFile = useAtomCommand(majordomeEnvironment.addTopicFile, {
    label: "add topic file",
    reportFailure: false,
  });
  const addPrivateDocument = useAtomCommand(majordomeEnvironment.addPrivateDocument, {
    label: "add private document",
    reportFailure: false,
    reportDefect: false,
  });
  const viewTopicFile = useAtomCommand(majordomeEnvironment.viewTopicFile, {
    label: "download topic file",
    reportFailure: false,
  });
  const viewPrivateDocument = useAtomCommand(majordomeEnvironment.viewPrivateDocument, {
    label: "download private document",
    reportFailure: false,
    reportDefect: false,
  });
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    label: "show topic file",
    reportFailure: false,
    reportDefect: false,
    refresh: true,
  });
  // The same list the Notes section reads, read again after an add: a Markdown file lands there.
  const refreshNotes = useAtomRefresh(
    workspaceRoot === null
      ? NO_NOTES
      : projectEnvironment.listEntries({
          environmentId,
          input: { cwd: workspaceRoot, directoryPath: topic.folder },
        }),
  );
  const now = Date.parse(`${useNowMinute()}:00Z`);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** Picked or dropped, waiting for the owner to say where they go. */
  const [choosing, setChoosing] = useState<ReadonlyArray<File> | null>(null);
  const [removing, setRemoving] = useState<TopicFileRow | null>(null);

  const data = AsyncResult.getOrElse(result, () => null);
  if (data === null) {
    // A server from before topics had files shows no card; a failed read says so once.
    if (result._tag !== "Failure" || isUnknownRequest(Cause.squash(result.cause))) return null;
    return (
      <ThreadDetailsSection
        headingId="thread-details-files-heading"
        title="Files"
        data-topic-panel-section
      >
        <p className="px-2.5 text-xs text-muted-foreground">This topic's files couldn't be read.</p>
      </ThreadDetailsSection>
    );
  }
  // Null where this machine keeps no private documents, or this connection may not open them.
  const privateDocuments = mayUsePrivate ? AsyncResult.getOrElse(privateResult, () => null) : null;
  const rows = topicFileRows(
    data.files,
    AsyncResult.getOrElse(privateResult, () => null)?.documents ?? [],
    where,
  );
  const more = moreFilesLine(data.total, data.files.length);

  const addAll = async (files: ReadonlyArray<File>, keepPrivate: boolean) => {
    setBusy(true);
    const taken = [...(privateDocuments?.documents ?? [])];
    for (const file of files) {
      const sent = await sendFile(file);
      let problem = sent.ok ? null : sent.message;
      if (sent.ok && keepPrivate) {
        const name = privateDocumentNameFor(file.name, taken);
        const added = await addPrivateDocument({
          environmentId,
          input: {
            attachmentId: sent.attachmentId,
            name,
            fileName: file.name,
            mediaType: sent.mediaType,
            topic: where,
          },
        });
        if (added._tag === "Success") taken.push(added.value);
        else if (!isAtomCommandInterrupted(added)) {
          problem = privateDocumentFailureMessage(squashAtomCommandFailure(added));
        }
      } else if (sent.ok) {
        const added = await addTopicFile({
          environmentId,
          input: { ...where, attachmentId: sent.attachmentId, fileName: file.name },
        });
        problem = failureMessage(added);
        // A Markdown file is a note: it shows under Notes, so this list would say nothing of it.
        if (added._tag === "Success" && isNoteFileName(added.value.name)) {
          // The server's own path: it numbers the name when the folder already had one like it.
          const { path } = added.value;
          const toastId = toastManager.add({
            type: "success",
            title: `${added.value.name} was added to this topic's notes`,
            description: "It is a note, so you'll find it in Notes.",
            actionProps: {
              children: "Open it",
              onClick: () => {
                toastManager.close(toastId);
                void navigate(notesLink({ projectId, environmentId, path }));
              },
            },
          });
        }
      }
      if (problem !== null) {
        toastManager.add({
          type: "error",
          title: `Could not add ${file.name}`,
          description: problem,
        });
      }
    }
    setBusy(false);
    refreshNotes();
  };

  const offer = (picked: ReadonlyArray<File>) => {
    const good: Array<File> = [];
    for (const file of picked) {
      const problem = topicFileProblem(file);
      if (problem === null) good.push(file);
      else toastManager.add({ type: "error", title: file.name, description: problem });
    }
    if (good.length === 0) return;
    if (privateDocuments !== null) setChoosing(good);
    else void addAll(good, false);
  };

  const download = async (row: TopicFileRow) => {
    const link =
      row.kind === "private"
        ? await viewPrivateDocument({ environmentId, input: { id: row.document.id } })
        : await viewTopicFile({ environmentId, input: { projectId, path: row.path } });
    const connection = readPreparedConnection(environmentId);
    const url =
      link._tag === "Success" && connection !== null
        ? resolveAssetUrl(connection.httpBaseUrl, link.value.relativeUrl)
        : null;
    if (url !== null) return saveFromUrl(url, row.name);
    if (link._tag === "Failure" && isAtomCommandInterrupted(link)) return;
    toastManager.add({
      type: "error",
      title: `Could not open ${row.name}`,
      description:
        link._tag !== "Failure"
          ? NOT_CONNECTED
          : row.kind === "private"
            ? privateDocumentFailureMessage(squashAtomCommandFailure(link))
            : (failureMessage(link) ?? NOT_CONNECTED),
    });
  };

  /** Whether opening this row shows it in a tab; a private document is only ever downloaded. */
  const previews = (row: TopicFileRow) =>
    row.kind === "file" && workspaceRoot !== null && topicFilePreviewable(row.name);

  const open = async (row: TopicFileRow) => {
    if (row.kind !== "file" || workspaceRoot === null || !previews(row)) return download(row);
    // Opened while the click still counts as the owner's, or the browser blocks the tab.
    const tab = window.desktopBridge ? null : window.open("", "_blank");
    if (tab !== null) tab.opener = null;
    const made = await createAssetUrl({
      environmentId,
      input: {
        resource: {
          _tag: "draft-workspace-file",
          cwd: workspaceRoot,
          path: `${workspaceRoot.replace(/[\\/]+$/, "")}/${row.path}`,
        },
      },
    });
    const connection = readPreparedConnection(environmentId);
    const url =
      made._tag === "Success" && connection !== null
        ? resolveAssetUrl(connection.httpBaseUrl, made.value.relativeUrl)
        : null;
    if (url !== null && tab !== null) return tab.location.replace(url);
    tab?.close();
    if (url !== null && (await window.desktopBridge?.openExternal(url))) return;
    return download(row);
  };

  const dropTarget = canChange
    ? {
        onDragOver: (event: DragEvent) => {
          if (!droppedFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        },
        onDragLeave: (event: DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (event: DragEvent) => {
          if (!droppedFiles(event)) return;
          event.preventDefault();
          setDragging(false);
          offer([...event.dataTransfer.files]);
        },
      }
    : {};

  return (
    <ThreadDetailsSection
      headingId="thread-details-files-heading"
      title="Files"
      data-topic-files={topic.id}
      data-topic-panel-section
      actions={
        canChange ? (
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {busy ? <Spinner size="sm" /> : null}
            {busy ? "Adding…" : "Add a file"}
          </Button>
        ) : undefined
      }
      {...dropTarget}
    >
      <div className="flex flex-col">
        {canChange ? (
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            aria-label={`Add a file to ${topic.title}`}
            tabIndex={-1}
            onChange={(event) => {
              const picked = [...(event.target.files ?? [])];
              // So picking the same file again still fires.
              event.target.value = "";
              offer(picked);
            }}
          />
        ) : null}
        {rows.length > 0 ? (
          <ul
            className="m-0 flex max-h-56 list-none flex-col overflow-y-auto p-0"
            aria-label={`Files of ${topic.title}`}
          >
            {rows.map((row) => {
              const locked = row.kind === "private" && !mayUsePrivate;
              const canRemove = row.kind === "private" ? mayUsePrivate : canChange;
              const hasActions = previews(row) || canRemove;
              const rowControl = (
                <ThreadDetailsControl
                  size="xs"
                  variant="ghost"
                  part="row"
                  panel
                  className="w-auto min-w-0 flex-1 shrink"
                  title={locked ? undefined : `${previews(row) ? "Open" : "Download"} ${row.name}`}
                  // A private one is served only to a connection that may open them.
                  disabled={locked}
                  onClick={() => void open(row)}
                >
                  {row.kind === "private" ? (
                    <LockIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-label="Private" />
                  ) : (
                    <FileIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span
                    // Makes room for the row's actions while they show.
                    className={cn(
                      "shrink-0 text-xs font-normal text-muted-foreground tabular-nums",
                      hasActions &&
                        "pointer-fine:group-focus-within/file:hidden pointer-fine:group-hover/file:hidden",
                    )}
                  >
                    {[formatAttachmentSize(row.sizeBytes), topicFileDate(row.at, now)]
                      .filter((part) => part !== "")
                      .join(" · ")}
                  </span>
                </ThreadDetailsControl>
              );
              return (
                <li key={row.key} className="group/file flex min-w-0 items-center gap-0.5">
                  {locked ? (
                    <Tooltip>
                      <TooltipTrigger render={<span className="flex min-w-0 flex-1" />}>
                        {rowControl}
                      </TooltipTrigger>
                      <TooltipPopup side="left" sideOffset={16}>
                        This device isn't allowed to open private documents.
                      </TooltipPopup>
                    </Tooltip>
                  ) : (
                    rowControl
                  )}
                  {/* Shown on hover or keyboard focus; always where there is no pointer to hover. */}
                  <span className="flex shrink-0 items-center pointer-fine:hidden pointer-fine:group-focus-within/file:flex pointer-fine:group-hover/file:flex">
                    {previews(row) ? (
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label={`Download ${row.name}`}
                        title="Download"
                        onClick={() => void download(row)}
                      >
                        <DownloadIcon />
                      </Button>
                    ) : null}
                    {canRemove ? (
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label={`Remove ${row.name}`}
                        title="Remove"
                        onClick={() => setRemoving(row)}
                      >
                        <XIcon />
                      </Button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-2.5 text-xs text-muted-foreground">
            Bills, scans and contracts you want kept with this topic.
          </p>
        )}
        {rows.length > 0 && workspaceRoot !== null ? (
          <button
            type="button"
            onClick={() =>
              useRightPanelStore
                .getState()
                .openFile(scopeThreadRef(environmentId, threadId), topic.folder)
            }
            className="mx-2.5 mt-1 self-start rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {more ?? "Browse and search the folder"}
          </button>
        ) : null}
        {dragging ? (
          <p className="px-2.5 pt-1 text-xs text-muted-foreground">
            Drop to keep it with {topic.title}.
          </p>
        ) : null}
        {data.large ? (
          <p className="px-2.5 pt-1 text-xs text-muted-foreground">
            Your notes folder is over 1 GB, so backups will take longer.
          </p>
        ) : null}
        <AlertDialog
          open={choosing !== null}
          onOpenChange={(next) => {
            if (!next) setChoosing(null);
          }}
        >
          {choosing ? (
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {choosing.length === 1
                    ? `Keep “${choosing[0]?.name}” with ${topic.title}?`
                    : `Keep ${choosing.length} files with ${topic.title}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  With the topic's notes, your assistant can read it and it is backed up with them.
                  Kept private, it is encrypted on this computer, outside your notes and their
                  backups, and your assistant asks you each time before opening it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
                <Button
                  variant="outline"
                  onClick={() => {
                    setChoosing(null);
                    void addAll(choosing, true);
                  }}
                >
                  <LockIcon />
                  Keep private
                </Button>
                <Button
                  onClick={() => {
                    setChoosing(null);
                    void addAll(choosing, false);
                  }}
                >
                  Add to the topic
                </Button>
              </AlertDialogFooter>
            </AlertDialogPopup>
          ) : null}
        </AlertDialog>
        <AlertDialog
          open={removing !== null}
          onOpenChange={(next) => {
            if (!next) setRemoving(null);
          }}
        >
          {removing ? (
            <RemoveFilePopup
              key={removing.key}
              environmentId={environmentId}
              projectId={projectId}
              row={removing}
              onClose={() => setRemoving(null)}
            />
          ) : null}
        </AlertDialog>
      </div>
    </ThreadDetailsSection>
  );
}

function RemoveFilePopup({
  environmentId,
  projectId,
  row,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly row: TopicFileRow;
  readonly onClose: () => void;
}) {
  const removeTopicFile = useAtomCommand(majordomeEnvironment.removeTopicFile, {
    label: "remove topic file",
    reportFailure: false,
  });
  const removePrivateDocument = useAtomCommand(majordomeEnvironment.removePrivateDocument, {
    label: "remove private document",
    reportFailure: false,
    reportDefect: false,
  });
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const problem =
      row.kind === "private"
        ? await removePrivateDocument({ environmentId, input: { id: row.document.id } }).then(
            (result) =>
              result._tag === "Failure" && !isAtomCommandInterrupted(result)
                ? privateDocumentFailureMessage(squashAtomCommandFailure(result))
                : null,
          )
        : failureMessage(
            await removeTopicFile({ environmentId, input: { projectId, path: row.path } }),
          );
    setBusy(false);
    if (problem !== null) {
      toastManager.add({ type: "error", title: "Could not remove it", description: problem });
    }
    onClose();
  };
  return (
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>Remove “{row.name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          {row.kind === "private"
            ? "Majordome deletes its encrypted copy. This can't be undone, so keep the original somewhere safe."
            : "It is deleted from this topic's folder. Your notes' history keeps a copy, so your assistant can bring it back if you ask."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
          Cancel
        </AlertDialogClose>
        <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
          {busy && <Spinner size="sm" />}
          Remove
        </Button>
      </AlertDialogFooter>
    </AlertDialogPopup>
  );
}
