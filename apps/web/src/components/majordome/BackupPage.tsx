import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  MajordomeBackupStatus,
  MajordomeGitHubConnectPrompt,
  ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CloudUploadIcon,
  FolderIcon,
  GithubIcon,
  ShieldIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useProjects } from "../../state/entities";
import { majordomeEnvironment, vaultBackupStatusesAtom } from "../../state/majordome";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
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
import { Checkbox } from "../ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { backupHeadline, folderFormProblem, restoreCommands } from "./backup.logic";

interface BackupVault {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly folderName: string;
}

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
}

export function BackupPage() {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const projects = useProjects().filter((project) => !project.isScratch && !project.archivedAt);
  const results = useAtomValue(
    vaultBackupStatusesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );

  const vaults: Array<{ vault: BackupVault; status: MajordomeBackupStatus }> = [];
  const errors: Array<string> = [];
  let loading = false;
  projects.forEach((project, index) => {
    const result = results[index];
    if (result === undefined || result._tag === "Initial") {
      loading = true;
      return;
    }
    if (result._tag === "Failure") {
      errors.push(`${project.title}: ${formatEnvironmentQueryError(result.cause)}`);
    }
    const status = AsyncResult.getOrElse(result, () => null);
    if (status?.isVault) {
      vaults.push({
        vault: {
          environmentId: project.environmentId,
          projectId: project.id,
          title: project.title,
          folderName: project.workspaceRoot.split(/[\\/]/).findLast((part) => part !== "") ?? "",
        },
        status,
      });
    }
  });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Back up my brain</h1>
        </WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer>
            {errors.map((error) => (
              <p key={error} className="text-sm text-destructive-foreground">
                {error}
              </p>
            ))}
            {vaults.length > 0 ? (
              <div className="flex flex-col gap-8">
                {vaults.map(({ vault, status }) => (
                  <VaultBackup
                    key={`${vault.environmentId}:${vault.projectId}`}
                    vault={vault}
                    status={status}
                    showName={vaults.length > 1}
                    nowMs={nowMs}
                  />
                ))}
              </div>
            ) : loading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No notes folder yet</EmptyTitle>
                  <EmptyDescription>
                    Open your notes folder in Majordome, then come back here to back it up.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Muted({ children }: { readonly children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function VaultBackup({
  vault,
  status,
  showName,
  nowMs,
}: {
  readonly vault: BackupVault;
  readonly status: MajordomeBackupStatus;
  readonly showName: boolean;
  readonly nowMs: number;
}) {
  const headline = backupHeadline(status);
  const canBackUp = useAtomValue(
    majordomeEnvironment.backUpNow.permissionAtom(vault.environmentId),
  );
  const canConfigure = useAtomValue(
    majordomeEnvironment.configureBackup.permissionAtom(vault.environmentId),
  );
  const backUpNow = useAtomCommand(majordomeEnvironment.backUpNow, { label: "back up now" });
  const configure = useAtomCommand(majordomeEnvironment.configureBackup, {
    label: "configure backup",
  });
  const [busy, setBusy] = useState(false);
  const when = (iso: string | null) => (iso === null ? null : formatRelativeTimeLabel(iso, nowMs));

  const runNow = async () => {
    setBusy(true);
    const result = await backUpNow({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId },
    });
    setBusy(false);
    if (result._tag === "Failure") reportFailure("Could not back up", result);
  };

  const setSyncing = async (enabled: boolean) => {
    const result = await configure({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, change: { type: "set-syncing", enabled } },
    });
    if (result._tag === "Failure") reportFailure("Could not change syncing", result);
  };

  const facts = [
    status.lastSavedAt === null ? null : `Your edits saved ${when(status.lastSavedAt)}`,
    status.remote?.lastSyncedAt ? `Sent ${when(status.remote.lastSyncedAt)}` : null,
    status.folder?.lastBackupAt ? `Folder copy ${when(status.folder.lastBackupAt)}` : null,
  ].filter((fact) => fact !== null);

  return (
    <div className="flex flex-col gap-4" data-backup-vault={vault.projectId}>
      {showName ? <h2 className="text-base font-medium">{vault.title}</h2> : null}
      <div className="flex items-start gap-3" data-backup-tone={headline.tone} aria-live="polite">
        {headline.tone === "ok" ? (
          <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-success-foreground" aria-hidden />
        ) : headline.tone === "warning" ? (
          <CircleAlertIcon className="mt-0.5 size-5 shrink-0 text-warning-foreground" aria-hidden />
        ) : (
          <CloudUploadIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{headline.title}</p>
          {headline.detail ? <Muted>{headline.detail}</Muted> : null}
          {status.paused !== null && status.paused.files.length > 0 ? (
            <ul className="mt-1 list-disc ps-5 text-sm text-foreground">
              {status.paused.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          ) : null}
          {status.saveError ? (
            <p className="text-sm text-destructive-foreground">{status.saveError}</p>
          ) : null}
          {facts.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">{facts.join(" · ")}</p>
          ) : null}
        </div>
        {canBackUp ? (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void runNow()}>
            {busy ? <Spinner size="sm" /> : null}
            Back up now
          </Button>
        ) : null}
      </div>
      {status.remote !== null ? (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            size="sm"
            checked={status.remote.syncing}
            disabled={!canConfigure}
            onCheckedChange={(checked) => void setSyncing(checked)}
          />
          Keep in sync with{" "}
          {status.remote.isGitHub ? "GitHub" : (status.remote.host ?? "the backup")}
          {status.remote.webUrl ? (
            <a
              href={status.remote.webUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Open
            </a>
          ) : null}
        </label>
      ) : null}
      {status.secretScan ? null : (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldIcon className="size-3.5" aria-hidden />
          The secret check (gitleaks) isn't installed on this computer, so notes are saved without
          it.
        </p>
      )}
      <GitHubOption vault={vault} status={status} canConfigure={canConfigure} />
      <FolderOption vault={vault} status={status} canConfigure={canConfigure} nowMs={nowMs} />
    </div>
  );
}

function GitHubOption({
  vault,
  status,
  canConfigure,
}: {
  readonly vault: BackupVault;
  readonly status: MajordomeBackupStatus;
  readonly canConfigure: boolean;
}) {
  const [open, setOpen] = useState(false);
  const configure = useAtomCommand(majordomeEnvironment.configureBackup, {
    label: "forget github",
  });
  const connected = status.remote?.isGitHub === true;

  const forget = async () => {
    const result = await configure({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, change: { type: "disconnect-github" } },
    });
    if (result._tag === "Failure") reportFailure("Could not forget the GitHub sign-in", result);
    else toastManager.add({ type: "success", title: "Majordome forgot your GitHub sign-in" });
  };

  return (
    <Section title="Connect GitHub">
      <Muted>
        Majordome creates a private repository called majordome-brain on your GitHub account and
        sends your notes there after every save.
      </Muted>
      <Muted>
        GitHub only offers this kind of sign-in with access to all your repositories. Majordome only
        uses it for your notes' backup.
      </Muted>
      {!status.github.available ? (
        <Muted>Connecting GitHub isn't set up on this server yet.</Muted>
      ) : canConfigure ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant={connected ? "outline" : "default"}
            onClick={() => setOpen(true)}
          >
            <GithubIcon />
            {connected ? "Connect another GitHub repository" : "Connect GitHub"}
          </Button>
          {status.github.signedIn ? (
            <Button size="xs" variant="ghost-muted" onClick={() => void forget()}>
              Forget GitHub sign-in
            </Button>
          ) : null}
        </div>
      ) : null}
      <AlertDialog open={open} onOpenChange={setOpen}>
        {open ? <ConnectGitHubPopup vault={vault} onClose={() => setOpen(false)} /> : null}
      </AlertDialog>
    </Section>
  );
}

function ConnectGitHubPopup({
  vault,
  onClose,
}: {
  readonly vault: BackupVault;
  readonly onClose: () => void;
}) {
  const start = useAtomCommand(majordomeEnvironment.connectGitHubStart, {
    label: "connect github",
  });
  const wait = useAtomCommand(majordomeEnvironment.connectGitHubWait, {
    label: "wait for github",
  });
  const cancel = useAtomCommand(majordomeEnvironment.connectGitHubCancel, {
    label: "cancel github",
  });
  const [prompt, setPrompt] = useState<MajordomeGitHubConnectPrompt | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "waiting">("idle");
  const target = { environmentId: vault.environmentId, input: { projectId: vault.projectId } };

  const begin = async () => {
    setPhase("starting");
    const started = await start(target);
    if (started._tag === "Failure") {
      reportFailure("Could not connect GitHub", started);
      setPhase("idle");
      return;
    }
    setPrompt(started.value);
    setPhase("waiting");
    const done = await wait(target);
    if (done._tag === "Failure") {
      reportFailure("GitHub isn't connected", done);
      setPhase("idle");
      setPrompt(null);
      return;
    }
    toastManager.add({
      type: done.value.remote?.backedUp ? "success" : "warning",
      title: done.value.remote?.backedUp
        ? "Backed up to GitHub"
        : "GitHub is connected; the first backup hasn't finished",
    });
    onClose();
  };

  const stop = async () => {
    if (phase === "waiting") await cancel(target);
    onClose();
  };

  return (
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>Connect GitHub</AlertDialogTitle>
        {prompt?.status === "code" ? (
          <AlertDialogDescription render={<div />}>
            <p>
              Open{" "}
              <a
                href={prompt.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {prompt.verificationUri.replace(/^https:\/\//, "")}
              </a>{" "}
              and enter this code:
            </p>
            <p className="my-3 font-mono text-2xl tracking-widest text-foreground" data-github-code>
              {prompt.userCode}
            </p>
            <p className="flex items-center gap-2">
              <Spinner size="sm" /> Waiting for GitHub…
            </p>
          </AlertDialogDescription>
        ) : prompt?.status === "signed-in" ? (
          <AlertDialogDescription render={<div />}>
            <p className="flex items-center gap-2">
              <Spinner size="sm" /> Creating your private repository and sending your notes…
            </p>
          </AlertDialogDescription>
        ) : (
          <AlertDialogDescription>
            You'll sign in on GitHub's website with a one-time code. GitHub asks to allow access to
            all your repositories; Majordome only creates and updates its own private backup.
          </AlertDialogDescription>
        )}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose render={<Button variant="outline" />} onClick={() => void stop()}>
          Cancel
        </AlertDialogClose>
        {phase === "idle" || phase === "starting" ? (
          <Button disabled={phase === "starting"} onClick={() => void begin()}>
            {phase === "starting" ? <Spinner size="sm" /> : null}
            Continue
          </Button>
        ) : null}
      </AlertDialogFooter>
    </AlertDialogPopup>
  );
}

function FolderOption({
  vault,
  status,
  canConfigure,
  nowMs,
}: {
  readonly vault: BackupVault;
  readonly status: MajordomeBackupStatus;
  readonly canConfigure: boolean;
  readonly nowMs: number;
}) {
  const [editing, setEditing] = useState(false);
  const configure = useAtomCommand(majordomeEnvironment.configureBackup, {
    label: "remove backup folder",
  });
  const folder = status.folder;

  const remove = async () => {
    const result = await configure({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, change: { type: "remove-folder" } },
    });
    if (result._tag === "Failure") reportFailure("Could not stop the folder backup", result);
  };

  return (
    <Section title="Choose a backup folder">
      <Muted>
        Every night Majordome puts an encrypted copy of your notes and their history in a folder you
        choose, such as iCloud Drive, Dropbox or a USB drive. It keeps the last 14 copies.
      </Muted>
      {folder !== null && !editing ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm text-foreground">
            <FolderIcon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate font-mono text-xs">{folder.path}</span>
          </p>
          <Muted>
            {folder.lastBackupAt
              ? `Last copy ${formatRelativeTimeLabel(folder.lastBackupAt, nowMs)}: ${folder.lastFile ?? ""}`
              : "No copy yet."}
          </Muted>
          {folder.lastError ? (
            <p className="text-sm text-destructive-foreground">{folder.lastError}</p>
          ) : null}
          {canConfigure ? (
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
                Change folder or passphrase
              </Button>
              <Button size="xs" variant="ghost-muted" onClick={() => void remove()}>
                Stop backing up to this folder
              </Button>
            </div>
          ) : null}
        </div>
      ) : canConfigure ? (
        <FolderForm
          vault={vault}
          initialPath={folder?.path ?? ""}
          onDone={() => setEditing(false)}
          {...(folder !== null ? { onCancel: () => setEditing(false) } : {})}
        />
      ) : null}
      <RestoreNote folderName={vault.folderName} />
    </Section>
  );
}

function FolderForm({
  vault,
  initialPath,
  onDone,
  onCancel,
}: {
  readonly vault: BackupVault;
  readonly initialPath: string;
  readonly onDone: () => void;
  readonly onCancel?: () => void;
}) {
  const configure = useAtomCommand(majordomeEnvironment.configureBackup, {
    label: "set backup folder",
  });
  const [path, setPath] = useState(initialPath);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [step, setStep] = useState<"form" | "write-down">("form");
  const [wroteItDown, setWroteItDown] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = folderFormProblem({ path, passphrase, confirmation });

  const save = async () => {
    setBusy(true);
    const result = await configure({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, change: { type: "set-folder", path, passphrase } },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      reportFailure("Could not use this folder", result);
      setStep("form");
      return;
    }
    toastManager.add({
      type: result.value.folder?.lastError ? "warning" : "success",
      title: result.value.folder?.lastError
        ? "The folder is set, but the first copy failed"
        : "Your first encrypted copy is in the folder",
    });
    setPassphrase("");
    setConfirmation("");
    onDone();
  };

  if (step === "write-down") {
    return (
      <div className="flex flex-col gap-3" data-recovery-phrase>
        <p className="text-sm font-medium text-foreground">Write down your passphrase</p>
        <Muted>
          It's the only way to open these backups. Majordome keeps it in this computer's keychain,
          but if this computer is lost you'll need it from paper. It won't be shown again.
        </Muted>
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-base break-all text-foreground">
          {passphrase}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={wroteItDown}
            onCheckedChange={(checked) => setWroteItDown(checked === true)}
          />
          I wrote it down
        </label>
        <div className="flex gap-2">
          <Button size="xs" variant="outline" disabled={busy} onClick={() => setStep("form")}>
            Back
          </Button>
          <Button size="xs" disabled={!wroteItDown || busy} onClick={() => void save()}>
            {busy ? <Spinner size="sm" /> : null}
            Back up to this folder
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null) {
          setWroteItDown(false);
          setStep("write-down");
        }
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Folder on this computer
        <Input
          value={path}
          placeholder="~/Library/Mobile Documents/com~apple~CloudDocs/Majordome"
          onChange={(event) => setPath(event.target.value)}
          aria-label="Backup folder"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Passphrase
        <Input
          type="password"
          value={passphrase}
          autoComplete="new-password"
          onChange={(event) => setPassphrase(event.target.value)}
          aria-label="Passphrase"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Passphrase again
        <Input
          type="password"
          value={confirmation}
          autoComplete="new-password"
          onChange={(event) => setConfirmation(event.target.value)}
          aria-label="Passphrase again"
        />
      </label>
      <p
        className={cn(
          "text-xs",
          problem === null ? "text-muted-foreground" : "text-warning-foreground",
        )}
      >
        {problem ?? "Next, you'll write the passphrase down."}
      </p>
      <div className="flex gap-2">
        {onCancel ? (
          <Button size="xs" variant="outline" type="button" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button size="xs" type="submit" disabled={problem !== null}>
          Continue
        </Button>
      </div>
    </form>
  );
}

function RestoreNote({ folderName }: { readonly folderName: string }) {
  const [decrypt, clone] = restoreCommands(folderName);
  return (
    <details className="text-sm text-muted-foreground">
      <summary className="cursor-pointer">How to restore from a folder copy</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p>
          You don't need Majordome to restore. Install age from age-encryption.org, then, in the
          folder with your copies, run these two commands. The first asks for your passphrase.
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
          {`${decrypt}\n${clone}`}
        </pre>
        <p>The my-notes folder then holds your notes and their whole history.</p>
      </div>
    </details>
  );
}
