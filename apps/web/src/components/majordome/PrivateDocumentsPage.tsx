import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  MAJORDOME_PRIVATE_DOCUMENT_DESCRIPTION_MAX,
  MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX,
  type MajordomePrivateDocument,
  type MajordomePrivateDocumentAccess,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { useEnvironments } from "../../state/environments";
import { attachmentEnvironment } from "../../state/attachments";
import { majordomeEnvironment } from "../../state/majordome";
import { formatEnvironmentQueryError } from "../../state/query";
import { readPreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatFullTimestamp } from "../../timestampFormat";
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
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { machineInSentence } from "./brains.logic";
import { isUnknownRequest } from "./connections.logic";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import {
  Disclosure,
  Entry,
  EntryList,
  Muted,
  Section,
  SectionTitle,
  StatusLine,
  Surface,
} from "./paper";
import {
  defaultDocumentName,
  describeAccess,
  fileProblem,
  nameProblem,
  privateDocumentFailureMessage,
} from "./privateDocuments.logic";
import { useMachineNames } from "./useMachineNames";

/** Documents the assistant may open only after the owner says yes, per machine that keeps them. */
export function PrivateDocumentsPage() {
  const { environments } = useEnvironments();
  const { primaryEnvironmentId, machineOf } = useMachineNames();
  const machines = [
    ...environments.filter((environment) => environment.environmentId === primaryEnvironmentId),
    ...environments.filter((environment) => environment.environmentId !== primaryEnvironmentId),
  ];

  return (
    <MajordomeSettingsPage
      searchId="majordome-private-documents"
      intro="For a passport scan, a tax return, a contract: files your assistant can use only after you say yes, each time. They are kept encrypted on one machine, outside your notes and their backups."
    >
      {machines.length === 0 ? (
        <Section>
          <Skeleton className="h-40 w-full" />
        </Section>
      ) : null}
      {machines.map((machine) => {
        const name = machines.length > 1 ? machineOf(machine.environmentId) : null;
        return (
          <div
            key={machine.environmentId}
            className={name === null ? undefined : "mt-10"}
            data-private-documents-machine={machine.environmentId}
          >
            {name !== null ? <SectionTitle>{name}</SectionTitle> : null}
            {machine.connection.phase === "connected" ? (
              <Machine environmentId={machine.environmentId} name={name} />
            ) : (
              <Muted className="mt-2">Majordome isn't connected to this machine right now.</Muted>
            )}
          </div>
        );
      })}
      <Section>
        <Disclosure summary="How private is this?">
          <p>
            Each document is encrypted on its own. The key stays on that machine: in the Keychain on
            a Mac, in Majordome's own folder on a server. A copy of your notes, their GitHub or
            Drive backup, or the document files themselves shows nothing readable.
          </p>
          <p>
            When you allow a request, Majordome makes a temporary readable copy of that one document
            for that conversation or routine, and deletes it when the run ends or after 15 minutes.
            The assistant has read it by then, so allow only what the task needs.
          </p>
          <p>
            It does not protect against someone who controls the machine or your account on it while
            Majordome is running. Passwords belong in a password manager, not here.
          </p>
        </Disclosure>
      </Section>
    </MajordomeSettingsPage>
  );
}

function Machine({
  environmentId,
  name,
}: {
  readonly environmentId: EnvironmentId;
  /** The machine's name, where several are shown. */
  readonly name: string | null;
}) {
  const result = useAtomValue(majordomeEnvironment.privateDocuments({ environmentId, input: {} }));
  const canAdd = useAtomValue(
    majordomeEnvironment.addPrivateDocument.permissionAtom(environmentId),
  );
  const [removing, setRemoving] = useState<MajordomePrivateDocument | null>(null);
  const labelAs = name === null ? "h2" : "h3";
  const sectionClassName = name === null ? undefined : "mt-5";
  const data = AsyncResult.getOrElse(result, () => null);

  if (data === null) {
    return (
      <Section className={sectionClassName}>
        {result._tag !== "Failure" ? (
          <Skeleton className="h-24 w-full" />
        ) : isUnknownRequest(Cause.squash(result.cause)) ? (
          <Muted>Update this server to keep private documents on it.</Muted>
        ) : (
          <p className="text-sm text-destructive-foreground">
            {formatEnvironmentQueryError(result.cause)}
          </p>
        )}
      </Section>
    );
  }

  const where = name === null ? "this machine" : machineInSentence(name);
  return (
    <>
      <Section label="Documents" labelAs={labelAs} className={sectionClassName}>
        {data.documents.length === 0 ? (
          <Muted>No private documents on {where} yet.</Muted>
        ) : (
          <EntryList aria-label="Private documents">
            {data.documents.map((document) => (
              <DocumentEntry
                key={document.id}
                environmentId={environmentId}
                document={document}
                canChange={canAdd}
                onRemove={() => setRemoving(document)}
              />
            ))}
          </EntryList>
        )}
        {canAdd ? (
          <AddDocument environmentId={environmentId} documents={data.documents} />
        ) : (
          <Muted className="mt-3">This connection can't add or open private documents.</Muted>
        )}
      </Section>
      <Section label="Who opened what" labelAs={labelAs}>
        {data.accessLog.length === 0 ? (
          <Muted>
            Nothing yet. Every request, every answer and every time a document is opened is listed
            here.
          </Muted>
        ) : (
          <EntryList aria-label="Who opened what">
            {data.accessLog.map((entry) => (
              <AccessEntry key={accessKey(entry)} entry={entry} />
            ))}
          </EntryList>
        )}
      </Section>
      <RemoveDialog
        environmentId={environmentId}
        document={removing}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}

const RECENT_ACCESS_SHOWN = 3;

const accessKey = (entry: MajordomePrivateDocumentAccess) =>
  `${entry.at}|${entry.documentId}|${entry.outcome}|${entry.requester?.threadId ?? ""}`;

/** On the Overview: the last few lines of this machine's access log, once it has documents. */
export function RecentPrivateDocumentAccess({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const data = AsyncResult.getOrElse(
    useAtomValue(majordomeEnvironment.privateDocuments({ environmentId, input: {} })),
    () => null,
  );
  if (data === null || data.accessLog.length === 0) return null;
  return (
    <Section
      label="Private documents"
      action={
        <Link to="/settings/private-documents" className="underline underline-offset-2">
          Who opened what
        </Link>
      }
    >
      <EntryList aria-label="Latest private document activity">
        {data.accessLog.slice(0, RECENT_ACCESS_SHOWN).map((entry) => (
          <AccessEntry key={accessKey(entry)} entry={entry} />
        ))}
      </EntryList>
    </Section>
  );
}

function DocumentEntry({
  environmentId,
  document,
  canChange,
  onRemove,
}: {
  readonly environmentId: EnvironmentId;
  readonly document: MajordomePrivateDocument;
  readonly canChange: boolean;
  readonly onRemove: () => void;
}) {
  const view = useAtomCommand(majordomeEnvironment.viewPrivateDocument, {
    label: "download private document",
    reportFailure: false,
    reportDefect: false,
  });
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    const result = await view({ environmentId, input: { id: document.id } });
    setBusy(false);
    const connection = readPreparedConnection(environmentId);
    const url =
      result._tag === "Success" && connection !== null
        ? resolveAssetUrl(connection.httpBaseUrl, result.value.relativeUrl)
        : null;
    if (url === null) {
      if (result._tag === "Failure" && isAtomCommandInterrupted(result)) return;
      toastManager.add({
        type: "error",
        title: "Could not download it",
        description:
          result._tag === "Failure"
            ? privateDocumentFailureMessage(squashAtomCommandFailure(result))
            : "Majordome isn't connected to this machine right now.",
      });
      return;
    }
    // As chat attachments are downloaded: the server answers with the file to save.
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = document.fileName;
    anchor.click();
  };
  const meta = [
    document.description,
    `Added ${new Date(document.addedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`,
    formatAttachmentSize(document.sizeBytes),
    document.fileName,
  ]
    .filter((part) => part !== "")
    .join(" · ");
  return (
    <Entry
      title={document.name}
      meta={meta}
      actions={
        canChange ? (
          <>
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void download()}>
              {busy ? <Spinner size="sm" /> : null}
              Download
            </Button>
            <Button size="xs" variant="ghost" onClick={onRemove}>
              Remove
            </Button>
          </>
        ) : undefined
      }
    />
  );
}

function AccessEntry({ entry }: { readonly entry: MajordomePrivateDocumentAccess }) {
  const line = describeAccess(entry);
  return (
    <Entry
      title={entry.documentName}
      meta={formatFullTimestamp(entry.at, "locale")}
      data-private-document-access={entry.outcome}
    >
      <StatusLine tone={line.tone}>{line.what}</StatusLine>
      {line.reason !== null ? (
        <Muted className="wrap-anywhere">Its reason: {line.reason}</Muted>
      ) : null}
    </Entry>
  );
}

function AddDocument({
  environmentId,
  documents,
}: {
  readonly environmentId: EnvironmentId;
  readonly documents: ReadonlyArray<MajordomePrivateDocument>;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const createUploadUrl = useAtomCommand(attachmentEnvironment.createUploadUrl, {
    label: "upload private document",
    reportFailure: false,
    reportDefect: false,
  });
  const add = useAtomCommand(majordomeEnvironment.addPrivateDocument, {
    label: "add private document",
    reportFailure: false,
    reportDefect: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    // So picking the same file again after a cancel still fires.
    event.target.value = "";
    if (picked === null) return;
    const problem = fileProblem(picked);
    setError(problem);
    if (problem !== null) return;
    setFile(picked);
    setName(defaultDocumentName(picked.name));
    setDescription("");
  };
  const close = () => {
    setFile(null);
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (file === null || busy) return;
    const problem = nameProblem(name, documents);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await upload(file);
    setBusy(false);
    if (failure === null) {
      close();
      toastManager.add({ type: "success", title: "Added", description: name.trim() });
    } else {
      setError(failure);
    }
  };

  /** Sends the file the way attachments go, then has the server encrypt it. Null when it worked. */
  const upload = async (picked: File): Promise<string | null> => {
    const mediaType = picked.type || "application/octet-stream";
    const minted = await createUploadUrl({
      environmentId,
      input: { type: "file", name: picked.name, mimeType: mediaType, sizeBytes: picked.size },
    });
    const connection = readPreparedConnection(environmentId);
    const url =
      minted._tag === "Success" && connection !== null
        ? resolveAssetUrl(connection.httpBaseUrl, minted.value.relativeUrl)
        : null;
    if (minted._tag !== "Success" || url === null) return "Could not start the upload. Try again.";
    const sent = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": mediaType },
      body: picked,
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (!sent) return "The upload did not arrive. Try again.";
    const added = await add({
      environmentId,
      input: {
        attachmentId: minted.value.attachmentId,
        name: name.trim(),
        ...(description.trim() === "" ? {} : { description: description.trim() }),
        fileName: picked.name,
        mediaType,
      },
    });
    return added._tag === "Success"
      ? null
      : privateDocumentFailureMessage(squashAtomCommandFailure(added));
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        aria-label="Choose a document"
        tabIndex={-1}
        onChange={choose}
      />
      {file === null ? (
        <div>
          <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
            Add a document
          </Button>
        </div>
      ) : (
        <Surface>
          <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
            <Muted className="wrap-anywhere">{file.name}</Muted>
            <Label className="flex flex-col items-stretch" htmlFor={`${id}-name`}>
              Name
              <Input
                nativeInput
                id={`${id}-name`}
                autoFocus
                maxLength={MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX}
                value={name}
                disabled={busy}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
            </Label>
            <Label className="flex flex-col items-stretch" htmlFor={`${id}-description`}>
              What it is (optional)
              <Input
                nativeInput
                id={`${id}-description`}
                maxLength={MAJORDOME_PRIVATE_DOCUMENT_DESCRIPTION_MAX}
                placeholder="Scan of my passport, valid until 2031"
                value={description}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Label>
            <Muted>
              Your assistant sees the name and this line, never the file, until you allow it.
            </Muted>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? <Spinner size="sm" /> : null}
                {busy ? "Encrypting…" : "Add document"}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={close}>
                Cancel
              </Button>
            </div>
          </form>
        </Surface>
      )}
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function RemoveDialog({
  environmentId,
  document,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly document: MajordomePrivateDocument | null;
  readonly onClose: () => void;
}) {
  return (
    <AlertDialog
      open={document !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {document ? (
        <RemoveDialogPopup
          key={document.id}
          environmentId={environmentId}
          document={document}
          onClose={onClose}
        />
      ) : null}
    </AlertDialog>
  );
}

function RemoveDialogPopup({
  environmentId,
  document,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly document: MajordomePrivateDocument;
  readonly onClose: () => void;
}) {
  const remove = useAtomCommand(majordomeEnvironment.removePrivateDocument, {
    label: "remove private document",
    reportFailure: false,
    reportDefect: false,
  });
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const result = await remove({ environmentId, input: { id: document.id } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Could not remove it",
        description: privateDocumentFailureMessage(squashAtomCommandFailure(result)),
      });
    }
    onClose();
  };
  return (
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>Remove “{document.name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          Majordome deletes its encrypted copy. This can't be undone, so keep the original somewhere
          safe.
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
