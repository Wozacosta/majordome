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
import { CheckIcon, ConciergeBellIcon } from "lucide-react";
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
import { cn } from "../../lib/utils";
import { welcomeTurn } from "../../onboarding/welcomePage.logic";
import {
  AGENT_ONBOARDING_THREAD_ID,
  AgentsSection,
  useWelcomeAgents,
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
 * Majordome's setup, as its first conversation: Majordome asks one thing at a time and each
 * answer is a control in the thread. The lines are fixed; no AI is signed in yet to write them.
 * The page stays open through the last question, so an install or sign-in is never cut short.
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
  if (environmentId === null) return null;
  return (
    <Conversation
      environmentId={environmentId}
      notesFolder={notesFolder}
      onStay={onStay}
      onLeave={onLeave}
    />
  );
}

function Conversation({
  environmentId,
  notesFolder,
  onStay,
  onLeave,
}: {
  readonly environmentId: EnvironmentId;
  readonly notesFolder: string | null;
  readonly onStay: () => void;
  readonly onLeave: () => void;
}) {
  const { environments } = useEnvironments();
  const handleNewThread = useNewThreadHandler();
  const assistant = useAssistantSettled(environmentId);
  const [name, setName] = useState("");
  const [named, setNamed] = useState(false);
  const [assistantSkipped, setAssistantSkipped] = useState(false);
  const [firstAsk, setFirstAsk] = useState("");
  /** The notes folder started here, which the first chat opens in. */
  const [startedProject, setStartedProject] = useState<ProjectId | null>(null);

  const ownerName = name.trim();
  const turn = welcomeTurn({
    named,
    assistantSettled: assistant.settled,
    assistantSkipped,
    hasNotes: notesFolder !== null,
  });
  const label =
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    "this computer";
  const hosted = isHostedServer(label);
  const about: MajordomeStartNotesInput["about"] = {
    ...(ownerName === "" ? {} : { name: ownerName }),
    language: navigator.language,
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  /** Sends what the owner wants help with as the first chat; Today's box takes it otherwise. */
  const askFirst = async (projectId: ProjectId, prompt: string) => {
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
  const leave = (prompt: string) => {
    onLeave();
    if (prompt === "") return;
    if (startedProject !== null && assistant.ready) void askFirst(startedProject, prompt);
    else keepFirstAsk(prompt);
  };

  return (
    <SidebarInset
      {...workspaceAreaProps("home", 1, "Welcome")}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
          <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-8 px-6 py-12">
            <Turn
              current={turn === "name"}
              line="Hello, I'm Majordome. What should I call you?"
              answer={
                ownerName === "" ? null : (
                  <Answer
                    onChange={notesFolder === null ? () => setNamed(false) : undefined}
                    changeLabel="Change your name"
                  >
                    {ownerName}
                  </Answer>
                )
              }
            >
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setNamed(true);
                }}
              >
                <Input
                  aria-label="What should I call you?"
                  autoComplete="given-name"
                  autoFocus
                  maxLength={MAJORDOME_OWNER_NAME_MAX}
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
                <Button type="submit">{ownerName === "" ? "Skip" : "Continue"}</Button>
              </form>
            </Turn>

            {named ? (
              <Turn
                current={turn === "assistant"}
                // An install or sign-in under way keeps its rows on screen whatever comes next.
                open={assistant.running || (!assistant.settled && !assistantSkipped)}
                line={
                  ownerName === ""
                    ? "Which AI should I think with?"
                    : `Nice to meet you, ${ownerName}. Which AI should I think with?`
                }
                answer={
                  assistant.ready ? (
                    <Done>Your assistant is ready</Done>
                  ) : (
                    <Answer onChange={() => setAssistantSkipped(false)} changeLabel="Choose an AI">
                      Later
                    </Answer>
                  )
                }
              >
                <AgentsSection
                  environmentId={environmentId}
                  label={label}
                  isPrimary
                  hosted={hosted}
                  bare
                  onImportSourceEnabled={() => undefined}
                />
                {turn === "assistant" ? (
                  <Button
                    variant="ghost-muted"
                    size="sm"
                    className="mt-2 self-start"
                    onClick={() => setAssistantSkipped(true)}
                  >
                    Continue without the assistant
                  </Button>
                ) : null}
              </Turn>
            ) : null}

            {turn === "notes" || turn === "firstAsk" ? (
              <Turn
                current={turn === "notes"}
                line="Where should I keep your notes?"
                answer={<Done>{notesFolder}</Done>}
              >
                <NotesFolderSetup
                  environmentId={environmentId}
                  hosted={hosted}
                  about={about}
                  onStay={onStay}
                  onStarted={setStartedProject}
                />
              </Turn>
            ) : null}

            {turn === "firstAsk" ? (
              <Turn
                current
                line={
                  ownerName === ""
                    ? "All set. What do you want help with first?"
                    : `All set, ${ownerName}. What do you want help with first?`
                }
                answer={null}
              >
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    leave(firstAsk.trim());
                  }}
                >
                  <Textarea
                    aria-label="What do you want help with first?"
                    autoFocus
                    rows={3}
                    maxLength={2000}
                    value={firstAsk}
                    onChange={(event) => setFirstAsk(event.target.value)}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost-muted" onClick={() => leave("")}>
                      Not now, open Today
                    </Button>
                    <Button type="submit" disabled={firstAsk.trim() === ""}>
                      Send
                    </Button>
                  </div>
                </form>
              </Turn>
            ) : null}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

// A turn just reached may sit below the fold of a short window.
const revealOnMount = (node: HTMLElement | null) => node?.scrollIntoView({ block: "nearest" });

/**
 * One thing Majordome says and what answers it. The turn being answered shows its controls;
 * an answered one keeps its line, smaller, with the answer under it.
 */
function Turn({
  current,
  open = current,
  line,
  answer,
  children,
}: {
  readonly current: boolean;
  /** Keeps the controls on screen after the conversation has moved on. */
  readonly open?: boolean;
  readonly line: string;
  readonly answer: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section ref={revealOnMount} className="flex gap-3">
      <ConciergeBellIcon
        aria-hidden
        className={cn(
          "mt-0.5 shrink-0",
          current ? "size-5 text-foreground" : "size-4 text-muted-foreground",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p
          className={
            current
              ? "text-lg leading-snug font-semibold tracking-tight text-foreground"
              : "text-sm text-muted-foreground"
          }
        >
          {line}
        </p>
        {open ? children : answer}
      </div>
    </section>
  );
}

/** What the owner said, on their side of the thread. */
function Answer({
  onChange,
  changeLabel,
  children,
}: {
  readonly onChange: (() => void) | undefined;
  readonly changeLabel: string;
  readonly children: ReactNode;
}) {
  const bubble = "self-end rounded-2xl bg-muted px-3 py-1.5 text-sm text-foreground";
  return onChange === undefined ? (
    <span className={bubble}>{children}</span>
  ) : (
    <button
      type="button"
      aria-label={changeLabel}
      className={cn(bubble, "hover:bg-accent")}
      onClick={onChange}
    >
      {children}
    </button>
  );
}

/** A step that finished without the owner typing anything. */
function Done({ children }: { readonly children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 self-end text-sm font-medium text-success-foreground">
      <CheckIcon className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}

/** True once an AI is ready and no install or sign-in started here is still running. */
function useAssistantSettled(environmentId: EnvironmentId) {
  const ready = useWelcomeAgents(environmentId).readyCount > 0;
  const running =
    useThreadRunningTerminalIds({ environmentId, threadId: AGENT_ONBOARDING_THREAD_ID }).length > 0;
  return { ready, running, settled: ready && !running };
}

function NotesFolderSetup({
  environmentId,
  hosted,
  about,
  onStay,
  onStarted,
}: {
  readonly environmentId: EnvironmentId;
  /** A server Majordome hosts, where the owner has no home folder to speak of. */
  readonly hosted: boolean;
  readonly about: MajordomeStartNotesInput["about"];
  /** Asked before the folder exists: the page has one more question after it. */
  readonly onStay: () => void;
  readonly onStarted: (projectId: ProjectId) => void;
}) {
  const startNotes = useAtomCommand(majordomeEnvironment.startNotes, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // Only the desktop app can show the computer's own folder picker.
  const canPickFolder = typeof window !== "undefined" && window.desktopBridge !== undefined;

  const start = async (folder: string | null) => {
    onStay();
    setBusy(true);
    const result = await startNotes({ environmentId, input: { folder, about } });
    setBusy(false);
    if (result._tag === "Success") {
      onStarted(result.value.projectId);
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
            onStart={onStay}
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
