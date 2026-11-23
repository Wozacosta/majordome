import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, MajordomeRestoreNotesResult } from "@t3tools/contracts";
import { useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { restoreCommands, restoreFormProblem } from "./backup.logic";
import { ChooseFolder } from "./FolderBrowser";
import { Disclosure } from "./paper";

/**
 * Brings notes back from an encrypted copy: where the copy is, its passphrase, and where the new
 * notes folder goes. The notes always land in a new folder, so nothing that exists is touched.
 */
export function RestoreNotes({
  environmentId,
  onThisComputer,
  onStart,
  onRestored,
  onCancel,
}: {
  readonly environmentId: EnvironmentId;
  /** Whether the notes' computer is the one this app runs on, so its own folder window can be used. */
  readonly onThisComputer: boolean;
  readonly onStart?: () => void;
  readonly onRestored: (result: MajordomeRestoreNotesResult) => void;
  readonly onCancel: () => void;
}) {
  const restore = useAtomCommand(majordomeEnvironment.restoreNotes, { reportFailure: false });
  const [source, setSource] = useState("");
  const [into, setInto] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = restoreFormProblem({ source, passphrase });
  const [decrypt, clone] = restoreCommands();

  const run = async () => {
    onStart?.();
    setBusy(true);
    setError(null);
    const result = await restore({ environmentId, input: { source, passphrase, into } });
    setBusy(false);
    if (result._tag === "Success") {
      setPassphrase("");
      onRestored(result.value);
    } else if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <form
      className="mt-2 flex max-w-xl flex-col gap-4 rounded-lg border border-border/70 p-4"
      data-restore-notes
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null && !busy) void run();
      }}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">1. Where is your backup?</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Choose the folder your copies are in. They are files with names that start with
          “majordome-” and end in “.age”; the newest one is used. For a copy in Google Drive,
          download the newest file from the “Majordome backups” folder first, then choose the folder
          you saved it in.
        </p>
        {source === "" ? null : (
          <p className="text-sm break-all text-foreground" data-restore-source>
            {source}
          </p>
        )}
        <ChooseFolder
          environmentId={environmentId}
          onThisComputer={onThisComputer}
          disabled={busy}
          label={source === "" ? "Choose folder" : "Choose another folder"}
          onChoose={(folder) => {
            setSource(folder);
            setError(null);
          }}
        />
        <Disclosure summary="Type a path instead">
          <Input
            value={source}
            placeholder="~/Downloads/majordome-notes-2026-01-31.age"
            onChange={(event) => setSource(event.target.value)}
            aria-label="Backup file or folder"
          />
        </Disclosure>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
        2. Your passphrase
        <span className="text-xs leading-relaxed font-normal text-muted-foreground">
          The one you wrote down when you set up the backup. It is used once, here, and not kept.
        </span>
        <Input
          type="password"
          value={passphrase}
          autoComplete="off"
          onChange={(event) => {
            setPassphrase(event.target.value);
            setError(null);
          }}
          aria-label="Passphrase"
        />
      </label>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">3. Where your notes go</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {into === null
            ? "A new folder called Majordome in your home folder."
            : `A new folder called Majordome inside ${into}.`}{" "}
          Nothing that is already on this computer is changed: if there is a Majordome folder there,
          the new one gets a number.
        </p>
        <ChooseFolder
          environmentId={environmentId}
          onThisComputer={onThisComputer}
          disabled={busy}
          label="Put them somewhere else"
          onChoose={setInto}
        />
        <Disclosure summary="Type a path instead">
          <Input
            value={into ?? ""}
            placeholder="~/Documents"
            onChange={(event) =>
              setInto(event.target.value.trim() === "" ? null : event.target.value)
            }
            aria-label="Folder to put your notes in"
          />
        </Disclosure>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm break-words text-destructive-foreground">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" type="submit" disabled={problem !== null || busy}>
          {busy ? <Spinner size="sm" /> : null}
          {busy ? "Bringing your notes back…" : "Restore my notes"}
        </Button>
        <Button size="sm" variant="outline" type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        {problem === null || busy ? null : (
          <span className="text-xs text-muted-foreground">{problem}</span>
        )}
      </div>
      <Disclosure summary="Without Majordome">
        <p>
          A backup can be opened on any computer, without this app. Install age from
          age-encryption.org, then, in the folder with your copy, run these two commands. The first
          asks for your passphrase.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 px-3 py-2.5 font-mono text-xs text-foreground">
          {`${decrypt}\n${clone}`}
        </pre>
        <p>The my-notes folder then holds your notes and their whole history.</p>
      </Disclosure>
    </form>
  );
}
