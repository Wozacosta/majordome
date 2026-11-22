import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { MajordomeTopic } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  CircleCheckIcon,
  FolderInputIcon,
  NotebookTextIcon,
  PencilIcon,
  ShapesIcon,
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
import { MenuItem } from "../ui/menu";
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
  /** Marks the topic as finished, or brings it back; says so, with a way to undo finishing. */
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
        finished
          ? `Could not mark ${topic.title} as finished`
          : `Could not bring ${topic.title} back`,
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
      title: `${topic.title} is finished`,
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

/** Rename, change folder, change icon and open the folder: a topic's menu, wherever it shows. */
export function TopicEditMenuItems({
  topic,
  actions,
}: {
  readonly topic: MajordomeTopic;
  readonly actions: TopicActions;
}) {
  return (
    <>
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
    </>
  );
}

export function TopicFinishMenuItem({
  topic,
  actions,
}: {
  readonly topic: MajordomeTopic;
  readonly actions: TopicActions;
}) {
  const finished = topic.finishedAt !== undefined;
  return (
    <MenuItem onClick={() => void actions.setFinished(topic, !finished)}>
      {finished ? <Undo2Icon /> : <CircleCheckIcon />}
      {finished ? "Bring back" : "Mark as finished"}
    </MenuItem>
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
            Its notes stay in {topic.folder}. Its chats move to Recent, and a routine that posts in
            this topic keeps posting in the same chat.
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
