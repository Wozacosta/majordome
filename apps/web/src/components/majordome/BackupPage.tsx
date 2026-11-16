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
  MajordomeGoogleDriveProblem,
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
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { backupHeadline, folderFormProblem, restoreCommands } from "./backup.logic";
import { groupBrains, labelCopies } from "./brains.logic";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import {
  Disclosure,
  Entry,
  EntryList,
  EntryTitle,
  Muted,
  READING_MEASURE_CLASS,
  Section,
  SectionTitle,
  HEADING_CLASS,
  StatusLine,
  Surface,
  SwitchLabel,
} from "./paper";
import { useMachineNames } from "./useMachineNames";

interface BackupVault {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly folderName: string;
  readonly brainId?: string | null | undefined;
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

  const { primaryEnvironmentId, machineOf, isElsewhere } = useMachineNames();

  const copies: Array<BackupVault & { readonly status: MajordomeBackupStatus }> = [];
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
      copies.push({
        environmentId: project.environmentId,
        projectId: project.id,
        title: project.title,
        folderName: project.workspaceRoot.split(/[\\/]/).findLast((part) => part !== "") ?? "",
        brainId: status.brainId,
        status,
      });
    }
  });
  // Each server saves and backs up its own copy, so a brain on several shows each, by machine.
  const vaults = labelCopies(groupBrains(copies, primaryEnvironmentId), machineOf);

  return (
    <MajordomeSettingsPage searchId="majordome-backup">
      {errors.length > 0 ? (
        <Section>
          {errors.map((error) => (
            <ErrorLine key={error}>{error}</ErrorLine>
          ))}
        </Section>
      ) : null}
      {vaults.length > 0 ? (
        vaults.map(({ copy, label }) => (
          <VaultBackup
            key={`${copy.environmentId}:${copy.projectId}`}
            vault={copy}
            status={copy.status}
            label={label}
            elsewhere={isElsewhere(copy.environmentId)}
            nowMs={nowMs}
          />
        ))
      ) : (
        <Section>
          {loading ? (
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
        </Section>
      )}
    </MajordomeSettingsPage>
  );
}

function ErrorLine({ children }: { readonly children: ReactNode }) {
  return <p className="text-sm break-words text-destructive-foreground">{children}</p>;
}

function VaultBackup({
  vault,
  status,
  label,
  elsewhere,
  nowMs,
}: {
  readonly vault: BackupVault;
  readonly status: MajordomeBackupStatus;
  /** The brain or machine this is, when several are listed. */
  readonly label: string | null;
  readonly elsewhere: boolean;
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

  const facts = [
    status.lastSavedAt === null ? null : `Your edits saved ${when(status.lastSavedAt)}`,
    status.remote?.lastSyncedAt ? `Sent ${when(status.remote.lastSyncedAt)}` : null,
    status.folder?.lastBackupAt ? `Folder copy ${when(status.folder.lastBackupAt)}` : null,
  ].filter((fact) => fact !== null);
  const remote = status.remote;

  return (
    <div className={label === null ? "mt-8" : "mt-10"} data-backup-vault={vault.projectId}>
      {label !== null ? <SectionTitle className="mb-3">{label}</SectionTitle> : null}
      <div
        className="flex flex-wrap items-start gap-x-3 gap-y-3"
        data-backup-tone={headline.tone}
        aria-live="polite"
      >
        {headline.tone === "ok" ? (
          <CircleCheckIcon className="mt-1 size-5 shrink-0 text-success-foreground" aria-hidden />
        ) : headline.tone === "warning" ? (
          <CircleAlertIcon className="mt-1 size-5 shrink-0 text-warning-foreground" aria-hidden />
        ) : (
          <CloudUploadIcon className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <p className={cn(HEADING_CLASS, "text-xl")}>{headline.title}</p>
          {headline.detail ? (
            <Muted className={READING_MEASURE_CLASS}>{headline.detail}</Muted>
          ) : null}
          {status.paused !== null && status.paused.files.length > 0 ? (
            <ul className="m-0 list-disc ps-5 text-sm break-all text-foreground">
              {status.paused.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          ) : null}
          {status.saveError ? <ErrorLine>{status.saveError}</ErrorLine> : null}
          {facts.length > 0 ? (
            <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>
          ) : null}
          {status.secretScan ? null : (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              The secret check (gitleaks) isn't installed on this computer, so notes are saved
              without it.
            </p>
          )}
        </div>
        {canBackUp ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void runNow()}>
            {busy ? <Spinner size="sm" /> : null}
            Back up now
          </Button>
        ) : null}
      </div>
      <Section label="Where your notes are kept" labelAs={label === null ? "h2" : "h3"}>
        <EntryList>
          <GitHubOption vault={vault} status={status} canConfigure={canConfigure} nowMs={nowMs} />
          {remote !== null && !remote.isGitHub ? (
            <Entry title={remote.host ?? "Another copy"} data-backup-destination="remote">
              <RemoteSync vault={vault} remote={remote} canConfigure={canConfigure} />
            </Entry>
          ) : null}
          {/* A folder on another machine, such as a server, isn't the iCloud or USB drive meant here. */}
          {elsewhere && status.folder === null ? null : (
            <FolderOption vault={vault} status={status} canConfigure={canConfigure} nowMs={nowMs} />
          )}
          <GoogleDriveOption
            vault={vault}
            status={status}
            canConfigure={canConfigure}
            nowMs={nowMs}
          />
        </EntryList>
      </Section>
    </div>
  );
}

/** "Keep in sync with GitHub": whether saved changes are sent on, with a link to where they go. */
function RemoteSync({
  vault,
  remote,
  canConfigure,
}: {
  readonly vault: BackupVault;
  readonly remote: NonNullable<MajordomeBackupStatus["remote"]>;
  readonly canConfigure: boolean;
}) {
  const configure = useAtomCommand(majordomeEnvironment.configureBackup, {
    label: "configure backup",
  });
  const setSyncing = async (enabled: boolean) => {
    const result = await configure({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, change: { type: "set-syncing", enabled } },
    });
    if (result._tag === "Failure") reportFailure("Could not change syncing", result);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3">
      <SwitchLabel>
        <Switch
          checked={remote.syncing}
          disabled={!canConfigure}
          onCheckedChange={(checked) => void setSyncing(checked)}
        />
        Keep in sync with {remote.isGitHub ? "GitHub" : (remote.host ?? "the backup")}
      </SwitchLabel>
      {remote.webUrl ? (
        <a
          href={remote.webUrl}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-10 items-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Open
        </a>
      ) : null}
    </div>
  );
}

function GitHubOption({
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
  const [open, setOpen] = useState(false);
  const configure = useAtomCommand(majordomeEnvironment.configureBackup, {
    label: "forget github",
  });
  const remote = status.remote?.isGitHub === true ? status.remote : null;
  const connected = remote !== null;
  // Notes cloned from GitHub onto a new server keep their repository; signing in lets it push.
  const needsSignIn = connected && !status.github.signedIn;

  const forget = async () => {
    const result = await configure({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, change: { type: "disconnect-github" } },
    });
    if (result._tag === "Failure") reportFailure("Could not forget the GitHub sign-in", result);
    else toastManager.add({ type: "success", title: "Majordome forgot your GitHub sign-in" });
  };

  const how = (
    <>
      <Muted className={READING_MEASURE_CLASS}>
        Majordome creates a private repository called majordome-brain on your GitHub account and
        sends your notes there after every save.
      </Muted>
      <Muted className={READING_MEASURE_CLASS}>
        GitHub only offers this kind of sign-in with access to all your repositories. Majordome only
        uses it for your notes' backup.
      </Muted>
    </>
  );

  return (
    <Entry title="GitHub" data-backup-destination="github">
      {remote === null ? (
        <StatusLine tone="neutral">Not connected</StatusLine>
      ) : needsSignIn ? (
        <StatusLine tone="warning">
          Sign in to GitHub so this computer can send your notes there
        </StatusLine>
      ) : !remote.syncing ? (
        <StatusLine tone="neutral">Connected, but syncing is off</StatusLine>
      ) : (
        <StatusLine tone="ok">
          {remote.lastSyncedAt
            ? `Connected · sent ${formatRelativeTimeLabel(remote.lastSyncedAt, nowMs)}`
            : "Connected"}
        </StatusLine>
      )}
      {remote !== null ? (
        <RemoteSync vault={vault} remote={remote} canConfigure={canConfigure} />
      ) : null}
      {connected ? null : how}
      {!status.github.available ? (
        <Muted>Connecting GitHub isn't set up on this server yet.</Muted>
      ) : canConfigure ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant={connected && !needsSignIn ? "outline" : "default"}
            onClick={() => setOpen(true)}
          >
            <GithubIcon />
            {needsSignIn
              ? "Sign in to GitHub"
              : connected
                ? "Connect another GitHub repository"
                : "Connect GitHub"}
          </Button>
          {status.github.signedIn ? (
            <Button size="xs" variant="ghost-muted" onClick={() => void forget()}>
              Forget GitHub sign-in
            </Button>
          ) : null}
        </div>
      ) : null}
      {connected ? <Disclosure summary="How this works">{how}</Disclosure> : null}
      <AlertDialog open={open} onOpenChange={setOpen}>
        {open ? <GitHubSignInPopup vault={vault} onClose={() => setOpen(false)} /> : null}
      </AlertDialog>
    </Entry>
  );
}

interface DeviceSignInCopy {
  readonly title: string;
  readonly intro: string;
  readonly waitingFor: string;
  readonly working: string;
}

const GITHUB_SIGN_IN: DeviceSignInCopy = {
  title: "Connect GitHub",
  intro:
    "You'll sign in on GitHub's website with a one-time code. GitHub asks to allow access to all your repositories; Majordome only creates and updates its own private backup.",
  waitingFor: "Waiting for GitHub…",
  working: "Creating your private repository and sending your notes…",
};

const GOOGLE_DRIVE_SIGN_IN: DeviceSignInCopy = {
  title: "Connect Google Drive",
  intro:
    "You'll sign in on Google's website with a one-time code. Majordome asks only to see and manage the files it creates in your Drive.",
  waitingFor: "Waiting for Google…",
  working: "Sending your first encrypted copy to Google Drive…",
};

type BackupTarget = {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly projectId: ProjectId };
};

/** A device sign-in: show the code, wait for the person to approve it, then report. */
function DeviceSignInPopup({
  vault,
  copy,
  start,
  wait,
  cancel,
  onConnected,
  onClose,
}: {
  readonly vault: BackupVault;
  readonly copy: DeviceSignInCopy;
  readonly start: (
    target: BackupTarget,
  ) => Promise<AtomCommandResult<MajordomeGitHubConnectPrompt, unknown>>;
  readonly wait: (
    target: BackupTarget,
  ) => Promise<AtomCommandResult<MajordomeBackupStatus, unknown>>;
  readonly cancel: (target: BackupTarget) => Promise<unknown>;
  readonly onConnected: (status: MajordomeBackupStatus) => void;
  readonly onClose: () => void;
}) {
  const [prompt, setPrompt] = useState<MajordomeGitHubConnectPrompt | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "waiting">("idle");
  const target = { environmentId: vault.environmentId, input: { projectId: vault.projectId } };

  const begin = async () => {
    setPhase("starting");
    const started = await start(target);
    if (started._tag === "Failure") {
      reportFailure(`Could not ${copy.title.toLowerCase()}`, started);
      setPhase("idle");
      return;
    }
    setPrompt(started.value);
    setPhase("waiting");
    const done = await wait(target);
    if (done._tag === "Failure") {
      reportFailure("The sign-in didn't finish", done);
      setPhase("idle");
      setPrompt(null);
      return;
    }
    onConnected(done.value);
    onClose();
  };

  const stop = async () => {
    if (phase === "waiting") await cancel(target);
    onClose();
  };

  return (
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>{copy.title}</AlertDialogTitle>
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
            <p
              className="my-3 font-mono text-2xl tracking-widest text-foreground"
              data-sign-in-code
            >
              {prompt.userCode}
            </p>
            <p className="flex items-center gap-2">
              <Spinner size="sm" /> {copy.waitingFor}
            </p>
          </AlertDialogDescription>
        ) : prompt?.status === "signed-in" ? (
          <AlertDialogDescription render={<div />}>
            <p className="flex items-center gap-2">
              <Spinner size="sm" /> {copy.working}
            </p>
          </AlertDialogDescription>
        ) : (
          <AlertDialogDescription>{copy.intro}</AlertDialogDescription>
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

function GitHubSignInPopup({
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
  return (
    <DeviceSignInPopup
      vault={vault}
      copy={GITHUB_SIGN_IN}
      start={start}
      wait={wait}
      cancel={cancel}
      onConnected={(status) =>
        toastManager.add({
          type: status.remote?.backedUp ? "success" : "warning",
          title: status.remote?.backedUp
            ? "Backed up to GitHub"
            : "GitHub is connected; the first backup hasn't finished",
        })
      }
      onClose={onClose}
    />
  );
}

function GoogleDriveSignInPopup({
  vault,
  onClose,
}: {
  readonly vault: BackupVault;
  readonly onClose: () => void;
}) {
  const start = useAtomCommand(majordomeEnvironment.connectGoogleDriveStart, {
    label: "connect google drive",
  });
  const wait = useAtomCommand(majordomeEnvironment.connectGoogleDriveWait, {
    label: "wait for google drive",
  });
  const cancel = useAtomCommand(majordomeEnvironment.connectGoogleDriveCancel, {
    label: "cancel google drive",
  });
  return (
    <DeviceSignInPopup
      vault={vault}
      copy={GOOGLE_DRIVE_SIGN_IN}
      start={start}
      wait={wait}
      cancel={cancel}
      onConnected={(status) =>
        toastManager.add({
          type: status.drive?.lastBackupAt ? "success" : "warning",
          title: status.drive?.lastBackupAt
            ? "Backed up to Google Drive"
            : "Google Drive is connected; the first copy hasn't gone up yet",
        })
      }
      onClose={onClose}
    />
  );
}

const DRIVE_PROBLEM_ACTION: Record<MajordomeGoogleDriveProblem, string | null> = {
  "signed-out": "Connect again",
  "access-removed": "Connect again",
  "quota-full": null,
  failed: null,
};

function GoogleDriveOption({
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
  const [open, setOpen] = useState(false);
  const [settingPassphrase, setSettingPassphrase] = useState(false);
  const configure = useAtomCommand(majordomeEnvironment.configureBackup, {
    label: "disconnect google drive",
  });
  const drive = status.drive;

  const disconnect = async () => {
    const result = await configure({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, change: { type: "disconnect-google-drive" } },
    });
    if (result._tag === "Failure") reportFailure("Could not disconnect Google Drive", result);
    else toastManager.add({ type: "success", title: "Google Drive is disconnected" });
  };

  const connectAction = drive?.problem ? DRIVE_PROBLEM_ACTION[drive.problem] : null;
  const how = (
    <>
      <Muted className={READING_MEASURE_CLASS}>
        Every night Majordome puts an encrypted copy of your notes and their history in a “Majordome
        backups” folder in your Google Drive. It can only see the files it puts there, and keeps the
        last 14 copies.
      </Muted>
      <Muted className={READING_MEASURE_CLASS}>
        Majordome's Google app is still in testing: only people Majordome invited can connect, and
        Google may warn that the app isn't verified. That's expected for now. While in testing,
        Google also asks you to connect again every 7 days.
      </Muted>
    </>
  );

  return (
    <Entry title="Google Drive" data-backup-destination="google-drive">
      {drive !== null ? (
        <div className="flex flex-col gap-2" data-google-drive="connected">
          <CopyStatus copy={drive} nowMs={nowMs} />
          {canConfigure ? (
            <div className="flex flex-wrap gap-2">
              {connectAction ? (
                <Button size="xs" onClick={() => setOpen(true)}>
                  {connectAction}
                </Button>
              ) : null}
              <Button size="xs" variant="ghost-muted" onClick={() => void disconnect()}>
                Disconnect Google Drive
              </Button>
            </div>
          ) : null}
          <Disclosure summary="How this works">{how}</Disclosure>
        </div>
      ) : (
        <>
          <StatusLine tone="neutral">Not connected</StatusLine>
          {how}
          {!status.googleDrive.available ? (
            <Muted>Connecting Google Drive isn't set up on this server yet.</Muted>
          ) : canConfigure ? (
            status.hasPassphrase ? (
              <div>
                <Button size="xs" onClick={() => setOpen(true)} data-google-drive="connect">
                  <CloudUploadIcon />
                  Connect Google Drive
                </Button>
              </div>
            ) : settingPassphrase ? (
              <FolderForm
                vault={vault}
                mode="passphrase"
                initialPath=""
                onDone={() => {
                  setSettingPassphrase(false);
                  setOpen(true);
                }}
                onCancel={() => setSettingPassphrase(false)}
              />
            ) : (
              <div>
                <Button
                  size="xs"
                  onClick={() => setSettingPassphrase(true)}
                  data-google-drive="choose-passphrase"
                >
                  <CloudUploadIcon />
                  Connect Google Drive
                </Button>
              </div>
            )
          ) : null}
        </>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        {open ? <GoogleDriveSignInPopup vault={vault} onClose={() => setOpen(false)} /> : null}
      </AlertDialog>
      <RestoreNote folderName={vault.folderName} source="drive" />
    </Entry>
  );
}

/** When the last encrypted copy went out, and what went wrong if the newest one didn't. */
function CopyStatus({
  copy,
  nowMs,
}: {
  readonly copy: {
    readonly lastBackupAt: string | null;
    readonly lastFile: string | null;
    readonly lastError: string | null;
  };
  readonly nowMs: number;
}) {
  return (
    <>
      <StatusLine tone={copy.lastError ? "warning" : copy.lastBackupAt ? "ok" : "neutral"}>
        <span className="break-words">
          {copy.lastBackupAt
            ? `Last copy ${formatRelativeTimeLabel(copy.lastBackupAt, nowMs)}: ${copy.lastFile ?? ""}`
            : "No copy yet."}
        </span>
      </StatusLine>
      {copy.lastError ? <ErrorLine>{copy.lastError}</ErrorLine> : null}
    </>
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

  const how = (
    <Muted className={READING_MEASURE_CLASS}>
      Every night Majordome puts an encrypted copy of your notes and their history in a folder you
      choose, such as iCloud Drive, Dropbox or a USB drive. It keeps the last 14 copies.
    </Muted>
  );

  return (
    <Entry title="Backup folder" data-backup-destination="folder">
      {folder !== null && !editing ? (
        <>
          <p className="flex min-w-0 items-center gap-2 text-foreground">
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate font-mono text-xs">{folder.path}</span>
          </p>
          <CopyStatus copy={folder} nowMs={nowMs} />
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
          <Disclosure summary="How this works">{how}</Disclosure>
        </>
      ) : (
        <>
          {folder === null ? <StatusLine tone="neutral">Not set up</StatusLine> : null}
          {how}
          {canConfigure ? (
            <FolderForm
              vault={vault}
              mode="folder"
              initialPath={folder?.path ?? ""}
              onDone={() => setEditing(false)}
              {...(folder !== null ? { onCancel: () => setEditing(false) } : {})}
            />
          ) : null}
        </>
      )}
      <RestoreNote folderName={vault.folderName} source="folder" />
    </Entry>
  );
}

/** The folder and passphrase form; with `mode="passphrase"`, only the passphrase. */
function FolderForm({
  vault,
  mode,
  initialPath,
  onDone,
  onCancel,
}: {
  readonly vault: BackupVault;
  readonly mode: "folder" | "passphrase";
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
  const problem = folderFormProblem({
    path: mode === "folder" ? path : null,
    passphrase,
    confirmation,
  });

  const save = async () => {
    setBusy(true);
    const result = await configure({
      environmentId: vault.environmentId,
      input: {
        projectId: vault.projectId,
        change:
          mode === "folder"
            ? { type: "set-folder", path, passphrase }
            : { type: "set-passphrase", passphrase },
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      reportFailure(
        mode === "folder" ? "Could not use this folder" : "Could not save the passphrase",
        result,
      );
      setStep("form");
      return;
    }
    if (mode === "passphrase") {
      setPassphrase("");
      setConfirmation("");
      onDone();
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
      <Surface className="flex max-w-xl flex-col gap-3" data-recovery-phrase>
        <EntryTitle>Write down your passphrase</EntryTitle>
        <Muted>
          It's the only way to open these backups. Majordome keeps it in this computer's keychain,
          but if this computer is lost you'll need it from paper. It won't be shown again.
        </Muted>
        <p className="rounded-md bg-muted px-3 py-2 font-mono text-base break-all text-foreground">
          {passphrase}
        </p>
        <SwitchLabel>
          <Checkbox
            checked={wroteItDown}
            onCheckedChange={(checked) => setWroteItDown(checked === true)}
          />
          I wrote it down
        </SwitchLabel>
        <div className="flex flex-wrap gap-2">
          <Button size="xs" variant="outline" disabled={busy} onClick={() => setStep("form")}>
            Back
          </Button>
          <Button size="xs" disabled={!wroteItDown || busy} onClick={() => void save()}>
            {busy ? <Spinner size="sm" /> : null}
            {mode === "folder" ? "Back up to this folder" : "Continue to Google"}
          </Button>
        </div>
      </Surface>
    );
  }

  return (
    <Surface className="max-w-xl">
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
        {mode === "folder" ? (
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Folder on this computer
            <Input
              value={path}
              placeholder="~/Library/Mobile Documents/com~apple~CloudDocs/Majordome"
              onChange={(event) => setPath(event.target.value)}
              aria-label="Backup folder"
            />
          </label>
        ) : (
          <Muted>Choose a passphrase to encrypt your copies. Google never sees your notes.</Muted>
        )}
        <label className="flex flex-col gap-1 text-sm text-foreground">
          Passphrase
          <Input
            type="password"
            value={passphrase}
            autoComplete="new-password"
            onChange={(event) => setPassphrase(event.target.value)}
            aria-label="Passphrase"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-foreground">
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
        <div className="flex flex-wrap gap-2">
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
    </Surface>
  );
}

function RestoreNote({
  folderName,
  source,
}: {
  readonly folderName: string;
  readonly source: "folder" | "drive";
}) {
  const [decrypt, clone] = restoreCommands(folderName);
  return (
    <Disclosure
      summary={
        source === "folder"
          ? "How to restore from a folder copy"
          : "How to restore from a Google Drive copy"
      }
    >
      <p className={READING_MEASURE_CLASS}>
        You don't need Majordome to restore.{" "}
        {source === "drive"
          ? "Download the newest .age file from the “Majordome backups” folder in Google Drive. "
          : ""}
        Install age from age-encryption.org, then, in the folder with your copy, run these two
        commands. The first asks for your passphrase.
      </p>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 px-3 py-2.5 font-mono text-xs text-foreground">
        {`${decrypt}\n${clone}`}
      </pre>
      <p>The my-notes folder then holds your notes and their whole history.</p>
    </Disclosure>
  );
}
