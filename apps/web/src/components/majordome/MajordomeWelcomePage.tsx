import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  MAJORDOME_OWNER_NAME_MAX,
  type MajordomeStartNotesInput,
  type ProjectId,
} from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { ensureLocalApi } from "../../localApi";
import { waitForProject } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { majordomeEnvironment } from "../../state/majordome";
import { isHostedServer } from "./brains.logic";
import { useThreadRunningTerminalIds } from "../../state/terminalSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AGENT_ONBOARDING_THREAD_ID,
  AgentsSection,
  useWelcomeAgents,
  WelcomeSection,
} from "../onboarding/WelcomePage";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { FolderBrowser } from "./FolderBrowser";
import { keepFirstAsk, requestDraftSend } from "./pendingDraftSend";
import { RestoreNotes } from "./RestoreNotes";

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
  const handleNewThread = useNewThreadHandler();
  const [name, setName] = useState("");
  const [firstAsk, setFirstAsk] = useState("");
  /** The notes folder started here while the assistant was not ready, whose first chat waits. */
  const [waitingProject, setWaitingProject] = useState<ProjectId | null>(null);
  if (environmentId === null) return null;

  /** Sends what the owner wants help with as the first chat; Today's box takes it otherwise. */
  const askFirst = async (projectId: ProjectId) => {
    const prompt = firstAsk.trim();
    if (prompt === "") return;
    const projectRef = scopeProjectRef(environmentId, projectId);
    // The folder was made a moment ago: a chat cannot be sent in a project this page has not heard of.
    const opened = await waitForProject(projectRef)
      .then(() => handleNewThread(projectRef, { prompt }))
      .catch(() => null);
    if (opened === null) {
      keepFirstAsk(prompt);
    } else if (
      useComposerDraftStore.getState().getComposerDraft(opened.draftId)?.prompt === prompt
    ) {
      requestDraftSend(opened.draftId);
    }
  };
  const about: MajordomeStartNotesInput["about"] = {
    ...(name.trim() === "" ? {} : { name: name.trim() }),
    language: navigator.language,
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
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
              notes in. Then Majordome opens on Today.
            </p>
            <div className="mt-10 border-t border-border/60">
              <AgentsSection
                environmentId={environmentId}
                label={label}
                isPrimary
                claudeOnly={isHostedServer(label)}
                onImportSourceEnabled={() => undefined}
              />
              {notesFolder === null ? (
                <WelcomeSection title="You">
                  <div className="flex flex-col gap-2 py-2">
                    <Input
                      aria-label="What should I call you?"
                      placeholder="What should I call you?"
                      autoComplete="given-name"
                      maxLength={MAJORDOME_OWNER_NAME_MAX}
                      value={name}
                      onChange={(event) => setName(event.currentTarget.value)}
                    />
                    <Textarea
                      aria-label="What do you want help with first?"
                      placeholder="What do you want help with first?"
                      rows={2}
                      maxLength={2000}
                      value={firstAsk}
                      onChange={(event) => setFirstAsk(event.target.value)}
                    />
                  </div>
                </WelcomeSection>
              ) : null}
              <WelcomeSection title="Notes">
                <NotesFolderSetup
                  environmentId={environmentId}
                  notesFolder={notesFolder}
                  hosted={isHostedServer(label)}
                  about={about}
                  onStay={onStay}
                  onStarted={(projectId, settled) => {
                    if (settled) void askFirst(projectId);
                    else setWaitingProject(projectId);
                  }}
                />
              </WelcomeSection>
            </div>
            {notesFolder === null ? null : (
              <SetupEnd
                environmentId={environmentId}
                onLeave={(ready) => {
                  onLeave();
                  if (waitingProject === null) return;
                  if (ready) void askFirst(waitingProject);
                  else keepFirstAsk(firstAsk.trim());
                }}
              />
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
  /** Told whether the assistant is ready to take a first message. */
  readonly onLeave: (ready: boolean) => void;
}) {
  const { ready } = useAssistantSettled(environmentId);
  return (
    <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
      {ready ? (
        <Button onClick={() => onLeave(true)}>Go to Today</Button>
      ) : (
        <>
          <span className="text-xs text-muted-foreground">
            The assistant is not ready yet. Finish its step above.
          </span>
          <Button variant="ghost-muted" onClick={() => onLeave(false)}>
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
  hosted,
  about,
  onStay,
  onStarted,
}: {
  readonly environmentId: EnvironmentId;
  readonly notesFolder: string | null;
  /** A server Majordome hosts, where the owner has no home folder to speak of. */
  readonly hosted: boolean;
  readonly about: MajordomeStartNotesInput["about"];
  readonly onStay: () => void;
  /** The folder is a notes folder now; `settled` when the assistant was ready as it started. */
  readonly onStarted: (projectId: ProjectId, settled: boolean) => void;
}) {
  const startNotes = useAtomCommand(majordomeEnvironment.startNotes, {
    reportFailure: false,
  });
  const { settled } = useAssistantSettled(environmentId);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // Only the desktop app can show the computer's own folder picker.
  const canPickFolder = typeof window !== "undefined" && window.desktopBridge !== undefined;

  const start = async (folder: string | null) => {
    if (!settled) onStay();
    setBusy(true);
    const result = await startNotes({ environmentId, input: { folder, about } });
    setBusy(false);
    if (result._tag === "Success") {
      onStarted(result.value.projectId, settled);
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
        description={
          hosted
            ? "A new notes folder on your Majordome server, ready to use."
            : "A new folder called Majordome in your home folder, ready to use."
        }
        action={
          <Button size="sm" disabled={busy} onClick={() => void start(null)}>
            Start new notes
          </Button>
        }
      />
      {hosted ? null : (
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
              forNotes
              onUse={(folder) => void start(folder)}
            />
          )}
        </NotesChoice>
      )}
      <NotesChoice
        title="Restore from a backup"
        description={
          hosted
            ? "Bring back notes from an encrypted copy Majordome made in Google Drive. You need the passphrase you wrote down."
            : "Bring back notes from an encrypted copy Majordome made, in a folder or in Google Drive. You need the passphrase you wrote down."
        }
        action={
          restoring ? null : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRestoring(true)}>
              Restore
            </Button>
          )
        }
      >
        {restoring ? (
          <RestoreNotes
            environmentId={environmentId}
            onThisComputer
            onStart={() => {
              if (!settled) onStay();
            }}
            onRestored={(result) =>
              toastManager.add({
                type: "success",
                title: "Your notes are back",
                description: result.folder,
              })
            }
            onCancel={() => setRestoring(false)}
          />
        ) : null}
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
