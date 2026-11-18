import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { FileIcon, LockIcon, XIcon } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { readPreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
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
import { toastManager } from "../ui/toast";
import { isUnknownRequest } from "./connections.logic";
import { privateDocumentFailureMessage } from "./privateDocuments.logic";
import {
  moreFilesLine,
  privateDocumentNameFor,
  topicFileProblem,
  type TopicFileRow,
  topicFileRows,
  topicOfThread,
} from "./topicFiles.logic";
import type { VaultTopic } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { usePendingUpload } from "./usePendingUpload";

const NOT_CONNECTED = "Majordome isn't connected to this machine right now.";

/** The documents kept with the topic this conversation belongs to. Nothing for any other chat. */
export function TopicFilesCard({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { copies } = useMajordomeVaults();
  const found = topicOfThread(copies, environmentId, threadId);
  if (found === null) return null;
  return (
    <TopicFiles
      key={`${found.projectId}:${found.topic.id}`}
      environmentId={environmentId}
      projectId={found.projectId}
      topic={found.topic}
    />
  );
}

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

function TopicFiles({
  environmentId,
  projectId,
  topic,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly topic: VaultTopic;
}) {
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
      <ThreadDetailsSection headingId="thread-details-files-heading" title="Files">
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
        problem = failureMessage(
          await addTopicFile({
            environmentId,
            input: { ...where, attachmentId: sent.attachmentId, fileName: file.name },
          }),
        );
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

  const open = async (row: TopicFileRow) => {
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
            {rows.map((row) => (
              <li key={row.key} className="flex min-w-0 items-center gap-0.5">
                <ThreadDetailsControl
                  size="xs"
                  variant="ghost"
                  part="row"
                  panel
                  className="w-auto flex-1 shrink"
                  title={row.name}
                  // A private one is served only to a connection that may open them.
                  disabled={row.kind === "private" && !mayUsePrivate}
                  onClick={() => void open(row)}
                >
                  {row.kind === "private" ? (
                    <LockIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-label="Private" />
                  ) : (
                    <FileIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                    {formatAttachmentSize(row.sizeBytes)}
                  </span>
                </ThreadDetailsControl>
                {(row.kind === "private" ? mayUsePrivate : canChange) ? (
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`Remove ${row.name}`}
                    onClick={() => setRemoving(row)}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {more !== null ? <p className="px-2.5 pt-1 text-xs text-muted-foreground">{more}</p> : null}
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
                  Kept private, it is encrypted on this machine, outside your notes and their
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
