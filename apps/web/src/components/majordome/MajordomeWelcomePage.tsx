import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowUpIcon, CheckIcon, FolderIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { ensureLocalApi } from "../../localApi";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { filesystemEnvironment } from "../../state/filesystem";
import { majordomeEnvironment } from "../../state/majordome";
import { useEnvironmentQuery } from "../../state/query";
import { useThreadRunningTerminalIds } from "../../state/terminalSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AGENT_ONBOARDING_THREAD_ID,
  AgentsSection,
  useWelcomeAgents,
  WelcomeSection,
} from "../onboarding/WelcomePage";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

/**
 * Majordome's setup: the assistant to install or sign in to, and the folder to start or pick.
 * Choosing the folder while the assistant is ready opens Today. Otherwise the page stays, so an
 * install or sign-in is not cut short, until the person leaves it.
 */
export function MajordomeWelcomePage({
  notesFolder,
  onStay,
  onLeave,
}: {
  /** The name of the notes folder once there is one. */
  readonly notesFolder: string | null;
  readonly onStay: () => void;
  readonly onLeave: () => void;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  if (environmentId === null) return null;
  const label =
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    "this computer";

  return (
    <SidebarInset
      {...workspaceAreaProps("home", 1, "Welcome")}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 pt-12 pb-8 sm:pt-20">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Welcome to Majordome
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Two things to set up: the assistant that does the work, and the folder it keeps your
              notes in.
            </p>
            <div className="mt-10 border-t border-border/60">
              <AgentsSection
                environmentId={environmentId}
                label={label}
                isPrimary
                onImportSourceEnabled={() => undefined}
              />
              <WelcomeSection title="Notes">
                <NotesFolderSetup
                  environmentId={environmentId}
                  notesFolder={notesFolder}
                  onStay={onStay}
                />
              </WelcomeSection>
            </div>
            {notesFolder === null ? null : (
              <SetupEnd environmentId={environmentId} onLeave={onLeave} />
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

/** True once an AI is ready and no install or sign-in started here is still running. */
function useAssistantSettled(environmentId: EnvironmentId) {
  const ready = useWelcomeAgents(environmentId).readyCount > 0;
  const running =
    useThreadRunningTerminalIds({ environmentId, threadId: AGENT_ONBOARDING_THREAD_ID }).length > 0;
  return { ready, settled: ready && !running };
}

/** The way out of a setup that stayed open: on to Today, with or without the assistant. */
function SetupEnd({
  environmentId,
  onLeave,
}: {
  readonly environmentId: EnvironmentId;
  readonly onLeave: () => void;
}) {
  const { ready } = useAssistantSettled(environmentId);
  return (
    <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
      {ready ? (
        <Button onClick={onLeave}>Go to Today</Button>
      ) : (
        <>
          <span className="text-xs text-muted-foreground">
            The assistant is not ready yet. Finish its step above.
          </span>
          <Button variant="ghost-muted" onClick={onLeave}>
            Continue without the assistant
          </Button>
        </>
      )}
    </div>
  );
}

function NotesFolderSetup({
  environmentId,
  notesFolder,
  onStay,
}: {
  readonly environmentId: EnvironmentId;
  readonly notesFolder: string | null;
  readonly onStay: () => void;
}) {
  const startNotes = useAtomCommand(majordomeEnvironment.startNotes, {
    reportFailure: false,
  });
  const { settled } = useAssistantSettled(environmentId);
  const [busy, setBusy] = useState(false);
  // Only the desktop app can show the computer's own folder picker.
  const canPickFolder = typeof window !== "undefined" && window.desktopBridge !== undefined;

  const start = async (folder: string | null) => {
    if (!settled) onStay();
    setBusy(true);
    const result = await startNotes({ environmentId, input: { folder } });
    setBusy(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: "Your notes folder is ready",
        description: result.value.folder,
      });
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not set up your notes",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const pick = async () => {
    const picked = await ensureLocalApi().dialogs.pickFolder();
    if (picked) await start(picked);
  };

  if (notesFolder !== null) {
    return (
      <div className="flex min-h-10 items-center gap-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {notesFolder}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-success-foreground">
          <CheckIcon className="size-3.5" aria-hidden />
          Ready
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <NotesChoice
        title="Start fresh"
        description="A new folder called Majordome in your home folder, ready to use."
        action={
          <Button size="sm" disabled={busy} onClick={() => void start(null)}>
            Start new notes
          </Button>
        }
      />
      <NotesChoice
        title="Use notes I already have"
        description="A folder of notes, such as an Obsidian vault. Majordome adds a few files of its own and changes nothing that is there."
        action={
          canPickFolder ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void pick()}>
              Choose folder
            </Button>
          ) : null
        }
      >
        {canPickFolder ? null : (
          <FolderBrowser
            environmentId={environmentId}
            disabled={busy}
            onUse={(folder) => void start(folder)}
          />
        )}
      </NotesChoice>
    </div>
  );
}

const withoutEndSlash = (folder: string) => folder.replace(/(?<=.)\/+$/, "");

/**
 * Picks a folder on the server's computer by walking its folders, for a browser, which has no
 * folder picker of its own. Starts in the home folder.
 */
function FolderBrowser({
  environmentId,
  disabled,
  onUse,
}: {
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
  readonly onUse: (folder: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("~/");
  const listing = useEnvironmentQuery(
    open ? filesystemEnvironment.browse({ environmentId, input: { partialPath: path } }) : null,
  );
  // The last folder that opened stays on screen while the next one loads or fails to open.
  const [shown, setShown] = useState(listing.data);
  const [home, setHome] = useState<string | null>(null);
  const [confirmingHome, setConfirmingHome] = useState(false);
  if (listing.data !== null && listing.data !== shown) {
    setShown(listing.data);
    if (path === "~/") setHome(withoutEndSlash(listing.data.parentPath));
  }
  const here = shown?.parentPath ?? null;
  const folders = (shown?.entries ?? []).filter((entry) => !entry.name.startsWith("."));
  const parent = here === null ? null : here.replace(/[^/]+\/?$/, "");
  const loading = open && listing.data === null && listing.error === null;
  const nameOf = (folder: string) => withoutEndSlash(folder).split("/").pop() ?? "";
  const hereName = here === null ? "" : nameOf(here);
  const go = (next: string) => {
    setConfirmingHome(false);
    if (next === path) listing.refresh();
    else setPath(next);
  };

  if (!open) {
    return (
      <div className="mt-2">
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
          Choose folder
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border/70">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Up one folder"
          disabled={parent === null || parent === "" || parent === here}
          onClick={() => parent && go(parent)}
        >
          <ArrowUpIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {here === null ? (listing.error === null ? "Looking…" : "") : shortFolder(here)}
        </span>
        {loading ? <Spinner size="xs" tone="muted" /> : null}
        <Button
          size="xs"
          variant="ghost-muted"
          onClick={() => {
            setConfirmingHome(false);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={disabled || here === null || loading || confirmingHome}
          onClick={() => {
            if (here === null) return;
            if (withoutEndSlash(here) === home) setConfirmingHome(true);
            else onUse(here);
          }}
        >
          {hereName === "" ? "Use this folder" : `Use “${hereName}”`}
        </Button>
      </div>
      {confirmingHome && here !== null ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2">
          <p className="min-w-0 flex-1 basis-64 text-xs leading-relaxed text-foreground">
            This is your whole home folder. Everything in it would count as your notes. A folder
            inside it is usually the better choice.
          </p>
          <Button size="xs" variant="outline" onClick={() => setConfirmingHome(false)}>
            Pick another
          </Button>
          <Button size="xs" variant="outline" disabled={disabled} onClick={() => onUse(here)}>
            Use my home folder
          </Button>
        </div>
      ) : null}
      {listing.error === null ? null : (
        <p role="alert" className="border-b border-border/60 px-3 py-1.5 text-xs text-destructive">
          {nameOf(path) === "" || path === "~/"
            ? "This folder could not be opened."
            : `“${nameOf(path)}” could not be opened.`}
        </p>
      )}
      <ul
        aria-label="Folders here"
        aria-busy={loading}
        className={cn("max-h-56 overflow-y-auto py-1", loading && "opacity-60")}
      >
        {folders.map((entry) => (
          <li key={entry.fullPath}>
            <button
              type="button"
              disabled={loading}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default"
              onClick={() => go(`${entry.fullPath}/`)}
            >
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{entry.name}</span>
            </button>
          </li>
        ))}
        {shown !== null && folders.length === 0 ? (
          <li className="px-3 py-1 text-xs leading-relaxed text-muted-foreground">
            No folders to show here. If you expected some, Majordome may not be allowed to look
            inside this one.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** The last two folders of a path, which is the part that tells folders apart. */
function shortFolder(folder: string): string {
  const parts = folder.split("/").filter((part) => part !== "");
  return parts.length <= 2 ? folder : `…/${parts.slice(-2).join("/")}`;
}

function NotesChoice({
  title,
  description,
  action,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly action: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="py-2">
      <div className="flex min-h-10 items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      {children}
    </div>
  );
}
