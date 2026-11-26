import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

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
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { machineInSentence } from "./brains.logic";
import { StatusLine } from "./paper";
import type { MainMove } from "./servers.logic";

/** Offered only to someone the server lets move routines. */
export function MakeMainButton({
  move,
  onClick,
}: {
  readonly move: MainMove;
  readonly onClick: () => void;
}) {
  const allowed = useAtomValue(
    majordomeEnvironment.runRoutinesHere.permissionAtom(move.target.environmentId),
  );
  return allowed ? (
    <Button
      size="xs"
      variant="ghost-muted"
      aria-label={`Make ${move.target.name} the main server`}
      onClick={onClick}
    >
      Make main
    </Button>
  ) : null;
}

export function MakeMainDialog({
  move,
  onClose,
}: {
  readonly move: MainMove | null;
  readonly onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog
      open={move !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      {move ? (
        <MakeMainPopup
          key={`${move.target.environmentId}:${move.target.projectId}`}
          move={move}
          busy={busy}
          setBusy={setBusy}
          onClose={onClose}
        />
      ) : null}
    </AlertDialog>
  );
}

function MakeMainPopup({
  move,
  busy,
  setBusy,
  onClose,
}: {
  readonly move: MainMove;
  readonly busy: boolean;
  readonly setBusy: (busy: boolean) => void;
  readonly onClose: () => void;
}) {
  const runHere = useAtomCommand(majordomeEnvironment.runRoutinesHere, { reportFailure: false });
  const runElsewhere = useAtomCommand(majordomeEnvironment.runRoutinesElsewhere, {
    reportFailure: false,
  });
  const [error, setError] = useState<string | null>(null);
  const target = machineInSentence(move.target.name);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const said = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
    const taken = await runHere({
      environmentId: move.target.environmentId,
      input: { projectId: move.target.projectId },
    });
    if (taken._tag === "Failure") {
      setBusy(false);
      if (!isAtomCommandInterrupted(taken)) {
        setError(`Nothing changed. ${said(squashAtomCommandFailure(taken))}`);
      }
      return;
    }
    // Each former runner is told directly: waiting for the notes to reach it would leave both
    // running the routines in the meantime.
    for (const other of move.stop) {
      const result = await runElsewhere({
        environmentId: other.environmentId,
        input: {
          projectId: other.projectId,
          environmentId: move.target.environmentId,
          label: move.target.name,
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        setBusy(false);
        setError(
          `${move.target.name} is the main one now, but ${machineInSentence(other.name)} could not be told to stop. It may need updating first. ${said(squashAtomCommandFailure(result))}`,
        );
        return;
      }
    }
    setBusy(false);
    toastManager.add({ type: "success", title: `${move.target.name} is now the main server` });
    onClose();
  };

  return (
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>Make {target} the main server?</AlertDialogTitle>
        <AlertDialogDescription>
          Your routines for {move.title} will run on {target}, the assistant will answer there, and
          your chats will be kept there.
          {move.stop.length === 0
            ? ""
            : ` ${move.stop.map((other) => other.name).join(" and ")} ${
                move.stop.length === 1 ? "stops" : "stop"
              } running them.`}{" "}
          Every computer keeps its copy of your notes.
        </AlertDialogDescription>
        {error === null ? null : <StatusLine tone="error">{error}</StatusLine>}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
          Cancel
        </AlertDialogClose>
        <Button disabled={busy} onClick={() => void confirm()}>
          {busy ? <Spinner size="sm" /> : null}
          Make main
        </Button>
      </AlertDialogFooter>
    </AlertDialogPopup>
  );
}
