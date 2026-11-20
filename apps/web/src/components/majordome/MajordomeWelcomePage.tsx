import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowUpIcon, FolderIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { isElectron } from "../../env";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { ensureLocalApi } from "../../localApi";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { filesystemEnvironment } from "../../state/filesystem";
import { majordomeEnvironment } from "../../state/majordome";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { AgentsSection, WelcomeSection } from "../onboarding/WelcomePage";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

/**
 * Majordome before it has a notes folder: the assistant to install or sign in to, and the folder
 * to start or pick. It closes by itself, since the home page shows Today once a folder is open.
 */
export function MajordomeWelcomePage() {
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
                <NotesFolderSetup environmentId={environmentId} />
              </WelcomeSection>
            </div>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function NotesFolderSetup({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const startNotes = useAtomCommand(majordomeEnvironment.startNotes, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  // Only the desktop app can show the computer's own folder picker.
  const canPickFolder = typeof window !== "undefined" && window.desktopBridge !== undefined;

  const start = async (folder: string | null) => {
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
  const here = listing.data?.parentPath ?? null;
  const folders = (listing.data?.entries ?? []).filter((entry) => !entry.name.startsWith("."));
  const parent = here === null ? null : here.replace(/[^/]+\/?$/, "");

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
          onClick={() => parent && setPath(parent)}
        >
          <ArrowUpIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {here === null ? "Looking…" : shortFolder(here)}
        </span>
        <Button
          size="xs"
          disabled={disabled || here === null}
          onClick={() => here !== null && onUse(here)}
        >
          Use this folder
        </Button>
      </div>
      <ul aria-label="Folders here" className="max-h-56 overflow-y-auto py-1">
        {folders.map((entry) => (
          <li key={entry.fullPath}>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => setPath(`${entry.fullPath}/`)}
            >
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{entry.name}</span>
            </button>
          </li>
        ))}
        {listing.data !== null && folders.length === 0 ? (
          <li className="px-3 py-1 text-xs text-muted-foreground">No folders inside this one.</li>
        ) : null}
        {listing.error ? (
          <li className="px-3 py-1 text-xs text-muted-foreground">
            This folder could not be opened.
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
