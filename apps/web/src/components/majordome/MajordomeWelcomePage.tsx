import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { type ReactNode, useState } from "react";

import { isElectron } from "../../env";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { ensureLocalApi } from "../../localApi";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { AgentsSection, WelcomeSection } from "../onboarding/WelcomePage";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
  const [typedFolder, setTypedFolder] = useState("");
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
          <form
            className="mt-2 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (typedFolder.trim() !== "") void start(typedFolder.trim());
            }}
          >
            <Input
              size="sm"
              aria-label="Folder on this computer"
              placeholder="/home/me/notes"
              value={typedFolder}
              onChange={(event) => setTypedFolder(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              type="submit"
              disabled={busy || typedFolder.trim() === ""}
            >
              Use this folder
            </Button>
          </form>
        )}
      </NotesChoice>
    </div>
  );
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
