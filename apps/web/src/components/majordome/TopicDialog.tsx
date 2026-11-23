import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  MajordomeReadyTopic,
  MajordomeSuggestTopicFolderResult,
  MajordomeTopic,
  ThreadId,
} from "@t3tools/contracts";
import { FolderIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { cn } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { TopicIconBadge } from "./TopicIcon";
import {
  filterTopicFolders,
  topicFolderFields,
  topicFolderRow,
  type MajordomeVault,
  type TopicFolderMode,
} from "./topics.logic";
import { useVaultRoutines } from "./useVaultRoutines";

/** What the dialog does: start a topic (maybe from a chat), rename one, or move its folder. */
export type TopicDialogRequest =
  | {
      readonly kind: "create";
      readonly title?: string;
      readonly folder?: string;
      readonly threadId?: ThreadId;
    }
  | { readonly kind: "rename"; readonly topic: MajordomeTopic }
  | { readonly kind: "folder"; readonly topic: MajordomeTopic };

/** Long enough that a name still being typed is not asked about. */
const SUGGESTION_DELAY_MS = 600;

export function TopicDialog({
  vault,
  request,
  onClose,
  onCreated,
}: {
  readonly vault: MajordomeVault;
  readonly request: TopicDialogRequest;
  readonly onClose: () => void;
  /** Awaited before the dialog closes, so it stays up until the new topic is on screen. */
  readonly onCreated?: ((topic: MajordomeTopic) => void | Promise<void>) | undefined;
}) {
  const id = useId();
  const createTopic = useAtomCommand(majordomeEnvironment.createTopic, {
    label: "add a topic",
    reportFailure: false,
  });
  const updateTopic = useAtomCommand(majordomeEnvironment.updateTopic, {
    label: "change a topic",
    reportFailure: false,
  });
  const openTopic = useAtomCommand(majordomeEnvironment.openTopic, {
    label: "open a topic",
    reportFailure: false,
  });
  const syncNotes = useAtomCommand(majordomeEnvironment.backUpNow, {
    label: "send a new topic to the computer that runs routines",
    reportFailure: false,
  });
  const addReadyRoutine = useAtomCommand(majordomeEnvironment.addReadyRoutine, {
    label: "add a routine",
    reportFailure: false,
  });
  // Routines run on one of the owner's computers, which is where a topic's routine is added.
  const { runner } = useVaultRoutines(vault);
  /** The ready-made topic the owner picked; null for one of their own. */
  const [ready, setReady] = useState<MajordomeReadyTopic | null>(null);
  const current = request.kind === "create" ? null : request.topic;
  const showTitle = request.kind !== "folder";
  const showFolder = request.kind !== "rename";
  const [title, setTitle] = useState(
    current?.title ?? (request.kind === "create" ? (request.title ?? "") : ""),
  );
  const presetFolder = request.kind === "create" ? request.folder : current?.folder;
  // A new topic with no folder given gets one suggested; null is a choice the owner has not made.
  const canSuggest = request.kind === "create" && presetFolder === undefined;
  const [mode, setMode] = useState<TopicFolderMode | null>(
    canSuggest
      ? null
      : presetFolder !== undefined && vault.folders.includes(presetFolder)
        ? "existing"
        : "new",
  );
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [existingFolder, setExistingFolder] = useState<string | null>(
    presetFolder !== undefined && vault.folders.includes(presetFolder) ? presetFolder : null,
  );
  const [query, setQuery] = useState("");
  // A new topic needs only its name: the folder is picked for it and can be changed on request.
  const [choosingFolder, setChoosingFolder] = useState(request.kind === "folder");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The server's answer for a name; no result when it could not be asked. */
  const [answer, setAnswer] = useState<{
    readonly title: string;
    readonly result: MajordomeSuggestTopicFolderResult | null;
  } | null>(null);

  const fields = topicFolderFields({
    title,
    projectsFolder: vault.projectsFolder,
    folders: vault.folders,
    mode,
    newFolder,
    existingFolder,
    suggestion: answer?.result ? { ...answer.result, title: answer.title } : null,
  });
  const folder = fields.mode === "new" ? fields.newFolder : (fields.existingFolder ?? "");

  const untouched = mode === null && newFolder === null && existingFolder === null;
  const wantedTitle = canSuggest && untouched ? title.trim() : "";
  const looking = wantedTitle !== "" && answer?.title !== wantedTitle;
  const presetTitle = request.kind === "create" ? (request.title ?? "").trim() : "";
  const delay = wantedTitle === presetTitle ? 0 : SUGGESTION_DELAY_MS;
  const { environmentId, projectId } = vault;
  const threadId = request.kind === "create" ? request.threadId : undefined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the suggestion comes from the server once the name has settled; the cleanup drops the timer and an answer for a name since changed
  useEffect(() => {
    if (!looking) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      void runAtomCommand(
        appAtomRegistry,
        majordomeEnvironment.suggestTopicFolder,
        {
          environmentId,
          input: { projectId, title: wantedTitle, ...(threadId === undefined ? {} : { threadId }) },
        },
        { label: "suggest a topic's folder", reportFailure: false, reportDefect: false },
      ).then((result) => {
        if (stale) return;
        setAnswer({
          title: wantedTitle,
          result: result._tag === "Success" ? result.value : null,
        });
      });
    }, delay);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [looking, wantedTitle, delay, environmentId, projectId, threadId]);
  const canSave = (!showTitle || title.trim() !== "") && (!showFolder || folder.trim() !== "");

  const pickReady = (picked: MajordomeReadyTopic) => {
    setReady(picked);
    setTitle(picked.title);
    setError(null);
    setMode(picked.existing ? "existing" : "new");
    setNewFolder(picked.existing ? null : picked.folder);
    setExistingFolder(picked.existing ? picked.folder : null);
  };

  /** The routine joins the topic's conversation; when that cannot start, it keeps its own. */
  const addRoutine = async (topic: MajordomeTopic, routine: { readonly key: string }) => {
    const copy = runner ?? vault;
    if (copy.environmentId !== environmentId) {
      // The topic list travels with the notes, and the other computer has not heard of this one.
      await syncNotes({ environmentId, input: { projectId, peerOnly: true } });
    }
    const opened = await openTopic({
      environmentId: copy.environmentId,
      input: { projectId: copy.projectId, topicId: topic.id },
    });
    const added = await addReadyRoutine({
      environmentId: copy.environmentId,
      input: {
        projectId: copy.projectId,
        key: routine.key,
        ...(opened._tag === "Success" ? { threadId: opened.value.threadId } : {}),
      },
    });
    if (added._tag !== "Failure" || isAtomCommandInterrupted(added)) return;
    const failure = squashAtomCommandFailure(added);
    toastManager.add({
      type: "warning",
      title: "The topic was added, but not its routine",
      description: `${failure instanceof Error ? failure.message : String(failure)} You can add it later from Routines.`,
    });
  };

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);
    const result =
      request.kind === "create"
        ? await createTopic({
            environmentId,
            input: {
              projectId,
              title: title.trim(),
              folder: folder.trim(),
              createFolder: fields.mode === "new",
              ...(request.threadId === undefined ? {} : { threadId: request.threadId }),
              ...(ready === null ? {} : { readyMade: ready.id }),
            },
          })
        : await updateTopic({
            environmentId,
            input: {
              projectId,
              topicId: request.topic.id,
              ...(showTitle ? { title: title.trim() } : {}),
              ...(showFolder ? { folder: folder.trim(), createFolder: fields.mode === "new" } : {}),
            },
          });
    if (result._tag === "Failure") {
      setBusy(false);
      if (isAtomCommandInterrupted(result)) return;
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : String(failure));
      return;
    }
    if (ready?.routine !== undefined) await addRoutine(result.value, ready.routine);
    await onCreated?.(result.value);
    setBusy(false);
    onClose();
  };

  const heading =
    request.kind === "rename"
      ? "Rename topic"
      : request.kind === "folder"
        ? "Change folder"
        : request.threadId !== undefined
          ? "Make this chat a topic"
          : "New topic";
  const description =
    request.kind === "rename"
      ? "The folder and its notes stay as they are."
      : request.kind === "folder"
        ? "The topic reads and keeps its log in this folder. No notes are moved."
        : "One ongoing chat about a subject, with its own notes, so nothing is lost when it gets long.";
  const readyTopics =
    request.kind === "create" && request.threadId === undefined && title.trim() === ""
      ? (vault.readyTopics ?? [])
      : [];
  const shownFolders = filterTopicFolders(vault.folders, query);
  // A search lists matches without their parents, so those keep their whole path.
  const listedFolders = new Set(query.trim() === "" ? shownFolders : []);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{heading}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {showTitle ? (
              <Label className="flex flex-col items-stretch" htmlFor={`${id}-title`}>
                Name
                <Input
                  nativeInput
                  id={`${id}-title`}
                  autoFocus
                  placeholder="Fitness, Accounting, Moving to Lisbon…"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setError(null);
                    // An emptied name starts over, with the ready-made topics on offer again.
                    if (ready !== null && event.target.value.trim() === "") {
                      setReady(null);
                      setMode(null);
                      setNewFolder(null);
                      setExistingFolder(null);
                    }
                  }}
                />
              </Label>
            ) : null}
            {ready !== null && title.trim() !== "" ? (
              <p className="text-xs text-muted-foreground">
                {ready.routine === undefined
                  ? "Comes with starter notes."
                  : `Comes with starter notes and the routine “${ready.routine.title}” (${ready.routine.when}), which you can change or switch off in Routines.`}
              </p>
            ) : null}
            {readyTopics.length > 0 ? (
              <div className="flex min-h-0 flex-col gap-1.5">
                <span id={`${id}-ready`} className="text-xs font-medium text-muted-foreground">
                  Or start from a ready-made topic
                </span>
                <ul
                  aria-labelledby={`${id}-ready`}
                  className="flex max-h-72 flex-col gap-px overflow-y-auto rounded-lg border p-1"
                >
                  {readyTopics.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        onClick={() => pickReady(candidate)}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <TopicIconBadge
                          topic={{
                            ...candidate,
                            threadId: null,
                            folderExists: true,
                            keyNote: null,
                          }}
                          statusDotClass={null}
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-sm font-medium">{candidate.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {candidate.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {showFolder && !choosingFolder ? (
              title.trim() === "" ? null : (
                <p
                  aria-live="polite"
                  className="flex min-h-6 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
                >
                  {looking ? (
                    "Finding a place for its notes…"
                  ) : (
                    <>
                      <span className="min-w-0 break-all">
                        {fields.mode === "existing"
                          ? "Its notes are already in "
                          : "Its notes will go in "}
                        <span className="font-medium text-foreground">{folder}</span>
                      </span>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost-muted"
                        onClick={() => setChoosingFolder(true)}
                      >
                        Change
                      </Button>
                    </>
                  )}
                </p>
              )
            ) : null}
            {showFolder && choosingFolder ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Folder for its notes</span>
                <ToggleGroup
                  aria-label="Folder"
                  className="w-full *:flex-1"
                  value={[fields.mode]}
                  onValueChange={(next) => {
                    const value = next[0];
                    setError(null);
                    if (value !== "new" && value !== "existing") return;
                    // A suggestion on show stays in its field once the owner starts choosing.
                    if (fields.suggested && fields.mode === "new") setNewFolder(fields.newFolder);
                    if (fields.suggested) setExistingFolder(fields.existingFolder);
                    setMode(value);
                  }}
                >
                  <Toggle value="new">New folder</Toggle>
                  <Toggle value="existing" disabled={vault.folders.length === 0}>
                    Existing folder
                  </Toggle>
                </ToggleGroup>
                {fields.mode === "new" ? (
                  <Input
                    nativeInput
                    aria-label="New folder"
                    value={folder}
                    onChange={(event) => {
                      setNewFolder(event.target.value);
                      setError(null);
                    }}
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    <Input
                      nativeInput
                      type="search"
                      aria-label="Find a folder"
                      placeholder="Find a folder"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <ul
                      role="listbox"
                      aria-label="Folders"
                      className="max-h-56 overflow-y-auto rounded-lg border p-1"
                    >
                      {shownFolders.length === 0 ? (
                        <li className="px-2 py-1.5 text-sm text-muted-foreground">
                          No folder matches.
                        </li>
                      ) : (
                        shownFolders.map((candidate) => (
                          <li
                            key={candidate}
                            style={{
                              paddingLeft: `${0.5 + topicFolderRow(candidate, listedFolders).depth * 1.25}rem`,
                            }}
                            role="option"
                            aria-selected={candidate === fields.existingFolder}
                            tabIndex={0}
                            onClick={() => {
                              setExistingFolder(candidate);
                              setError(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setExistingFolder(candidate);
                              }
                            }}
                            className={cn(
                              "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                              candidate === fields.existingFolder && "bg-accent font-medium",
                            )}
                          >
                            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 truncate">
                              {topicFolderRow(candidate, listedFolders).name}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                )}
                {canSuggest ? (
                  <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
                    {looking
                      ? "Looking for the best place…"
                      : fields.suggested
                        ? "Suggested from your folders."
                        : null}
                  </p>
                ) : null}
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave || busy}>
              {busy ? <Spinner size="sm" /> : null}
              {request.kind === "create" ? "Add topic" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
