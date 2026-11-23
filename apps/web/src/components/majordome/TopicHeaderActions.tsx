import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { MajordomeTopic } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleCheckIcon,
  FolderInputIcon,
  MessageCirclePlusIcon,
  NotebookTextIcon,
  PencilIcon,
  ShapesIcon,
  TrashIcon,
  Undo2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
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
import { MenuItem, MenuSeparator } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { notesLink } from "./notes.logic";
import { TopicDialog, type TopicDialogRequest } from "./TopicDialog";
import { TopicIconDialog } from "./TopicIcon";
import type { MajordomeVault } from "./topics.logic";

export function reportTopicFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
}

export interface TopicActions {
  /** Opens the dialog that starts, renames or moves a topic. */
  readonly openDialog: (request: TopicDialogRequest) => void;
  readonly changeIcon: (topic: MajordomeTopic) => void;
  readonly openFolder: (topic: MajordomeTopic) => void;
  /** Marks the topic as done, or brings it back; says so, with a way to undo. */
  readonly setFinished: (topic: MajordomeTopic, finished: boolean) => Promise<void>;
  readonly remove: (topic: MajordomeTopic) => void;
  /** The dialogs these open; render it once, beside the menus. */
  readonly dialogs: ReactNode;
}

/** What can be done to a topic, the same from the sidebar's list and from its chat's header. */
export function useTopicActions(
  vault: MajordomeVault,
  options?: {
    readonly onCreated?: (topic: MajordomeTopic) => void | Promise<void>;
    /** Runs before leaving for Notes, for a sidebar that covers the page to close. */
    readonly onLeave?: () => void;
  },
): TopicActions {
  const [dialog, setDialog] = useState<TopicDialogRequest | null>(null);
  const [removing, setRemoving] = useState<MajordomeTopic | null>(null);
  const [choosingIcon, setChoosingIcon] = useState<MajordomeTopic | null>(null);
  const navigate = useNavigate();
  const updateTopic = useAtomCommand(majordomeEnvironment.updateTopic, {
    label: "finish a topic",
    reportFailure: false,
  });

  const setFinished = async (topic: MajordomeTopic, finished: boolean) => {
    const result = await updateTopic({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, topicId: topic.id, finished },
    });
    if (result._tag === "Failure") {
      reportTopicFailure(
        finished ? `Could not mark ${topic.title} as done` : `Could not bring ${topic.title} back`,
        result,
      );
      return;
    }
    if (!finished) {
      toastManager.add({ type: "success", title: `${topic.title} is back in your topics` });
      return;
    }
    const toastId = toastManager.add({
      type: "success",
      title: `${topic.title} is marked as done`,
      description: "Its notes and chat are kept.",
      actionProps: {
        children: "Undo",
        onClick: () => {
          toastManager.close(toastId);
          void setFinished(topic, false);
        },
      },
    });
  };

  return {
    openDialog: setDialog,
    changeIcon: setChoosingIcon,
    openFolder: (topic) => {
      options?.onLeave?.();
      void navigate(
        notesLink({
          projectId: vault.projectId,
          environmentId: vault.environmentId,
          path: topic.keyNote ?? undefined,
        }),
      );
    },
    setFinished,
    remove: setRemoving,
    dialogs: (
      <>
        {dialog !== null ? (
          <TopicDialog
            vault={vault}
            request={dialog}
            onClose={() => setDialog(null)}
            onCreated={dialog.kind === "create" ? options?.onCreated : undefined}
          />
        ) : null}
        {removing !== null ? (
          <RemoveTopicDialog vault={vault} topic={removing} onClose={() => setRemoving(null)} />
        ) : null}
        {choosingIcon !== null ? (
          <TopicIconDialog
            vault={vault}
            topic={choosingIcon}
            onClose={() => setChoosingIcon(null)}
          />
        ) : null}
      </>
    ),
  };
}

/**
 * A topic's menu, the same wherever it shows: on its row in the sidebar and in its chat's header.
 * A topic marked as done offers no new chat and has no place to move to.
 */
export function TopicMenuItems({
  topic,
  actions,
  onNewChat,
  onMove,
}: {
  readonly topic: MajordomeTopic;
  readonly actions: TopicActions;
  readonly onNewChat: () => void;
  /** The ways to move it in the sidebar's list; null where it cannot move. */
  readonly onMove?: {
    readonly up: boolean;
    readonly down: boolean;
    readonly by: (offset: number) => void;
  } | null;
}) {
  const done = topic.finishedAt !== undefined;
  return (
    <>
      {done ? null : (
        <>
          <MenuItem onClick={onNewChat}>
            <MessageCirclePlusIcon />
            New chat about this
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      <MenuItem onClick={() => actions.openDialog({ kind: "rename", topic })}>
        <PencilIcon />
        Rename
      </MenuItem>
      <MenuItem onClick={() => actions.openDialog({ kind: "folder", topic })}>
        <FolderInputIcon />
        Change folder
      </MenuItem>
      <MenuItem onClick={() => actions.changeIcon(topic)}>
        <ShapesIcon />
        Change icon
      </MenuItem>
      <MenuItem onClick={() => actions.openFolder(topic)}>
        <NotebookTextIcon />
        Open folder in Notes
      </MenuItem>
      {done || onMove == null ? null : (
        <>
          <MenuSeparator />
          <MenuItem disabled={!onMove.up} onClick={() => onMove.by(-1)}>
            <ArrowUpIcon />
            Move up
          </MenuItem>
          <MenuItem disabled={!onMove.down} onClick={() => onMove.by(1)}>
            <ArrowDownIcon />
            Move down
          </MenuItem>
        </>
      )}
      <MenuSeparator />
      <MenuItem onClick={() => void actions.setFinished(topic, !done)}>
        {done ? <Undo2Icon /> : <CircleCheckIcon />}
        {done ? "Bring back" : "Mark as done"}
      </MenuItem>
      <MenuItem variant="destructive" onClick={() => actions.remove(topic)}>
        <TrashIcon />
        Remove topic
      </MenuItem>
    </>
  );
}

function RemoveTopicDialog({
  vault,
  topic,
  onClose,
}: {
  readonly vault: MajordomeVault;
  readonly topic: MajordomeTopic;
  readonly onClose: () => void;
}) {
  const removeTopic = useAtomCommand(majordomeEnvironment.removeTopic, {
    label: "remove a topic",
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const result = await removeTopic({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, topicId: topic.id },
    });
    setBusy(false);
    if (result._tag === "Failure") reportTopicFailure(`Could not remove ${topic.title}`, result);
    onClose();
  };
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {topic.title} from your topics?</AlertDialogTitle>
          <AlertDialogDescription>
            Its notes stay in {topic.folder}. Its chats move to Chats, outside any topic, and a
            routine that posts in this topic keeps posting in the same chat.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
            Cancel
          </AlertDialogClose>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            Remove topic
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
