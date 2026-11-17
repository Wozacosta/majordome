import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { MajordomeTopic, ThreadId } from "@t3tools/contracts";
import { FolderIcon } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "../../lib/utils";
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
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  defaultTopicFolder,
  filterTopicFolders,
  topicFolderRow,
  type MajordomeVault,
} from "./topics.logic";

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

type FolderMode = "new" | "existing";

export function TopicDialog({
  vault,
  request,
  onClose,
  onCreated,
}: {
  readonly vault: MajordomeVault;
  readonly request: TopicDialogRequest;
  readonly onClose: () => void;
  readonly onCreated?: ((topic: MajordomeTopic) => void) | undefined;
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
  const current = request.kind === "create" ? null : request.topic;
  const showTitle = request.kind !== "folder";
  const showFolder = request.kind !== "rename";
  const [title, setTitle] = useState(
    current?.title ?? (request.kind === "create" ? (request.title ?? "") : ""),
  );
  const presetFolder = request.kind === "create" ? request.folder : current?.folder;
  const [mode, setMode] = useState<FolderMode>(
    presetFolder !== undefined && vault.folders.includes(presetFolder) ? "existing" : "new",
  );
  // The new folder follows the title until the owner types one.
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [existingFolder, setExistingFolder] = useState<string | null>(
    presetFolder !== undefined && vault.folders.includes(presetFolder) ? presetFolder : null,
  );
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const folder =
    mode === "new"
      ? (newFolder ?? defaultTopicFolder(vault.projectsFolder, title))
      : (existingFolder ?? "");
  const canSave = (!showTitle || title.trim() !== "") && (!showFolder || folder.trim() !== "");

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);
    const result =
      request.kind === "create"
        ? await createTopic({
            environmentId: vault.environmentId,
            input: {
              projectId: vault.projectId,
              title: title.trim(),
              folder: folder.trim(),
              createFolder: mode === "new",
              ...(request.threadId === undefined ? {} : { threadId: request.threadId }),
            },
          })
        : await updateTopic({
            environmentId: vault.environmentId,
            input: {
              projectId: vault.projectId,
              topicId: request.topic.id,
              ...(showTitle ? { title: title.trim() } : {}),
              ...(showFolder ? { folder: folder.trim(), createFolder: mode === "new" } : {}),
            },
          });
    setBusy(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : String(failure));
      return;
    }
    onCreated?.(result.value);
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
        : "A topic is one ongoing conversation. Its notes and running log live in a folder of your notes, so nothing is lost when the chat gets long.";
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
                  }}
                />
              </Label>
            ) : null}
            {showFolder ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Folder</span>
                <ToggleGroup
                  aria-label="Folder"
                  className="w-full *:flex-1"
                  value={[mode]}
                  onValueChange={(next) => {
                    const value = next[0];
                    if (value === "new" || value === "existing") setMode(value);
                    setError(null);
                  }}
                >
                  <Toggle value="new">New folder</Toggle>
                  <Toggle value="existing" disabled={vault.folders.length === 0}>
                    Existing folder
                  </Toggle>
                </ToggleGroup>
                {mode === "new" ? (
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
                            aria-selected={candidate === existingFolder}
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
                              candidate === existingFolder && "bg-accent font-medium",
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
