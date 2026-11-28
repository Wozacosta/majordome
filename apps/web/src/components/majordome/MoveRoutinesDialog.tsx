import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, MajordomeRoutinesRunner, ProjectId } from "@t3tools/contracts";
import { useAtom } from "@effect/atom-react";
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
import { takeOverHereAtom } from "./conversationHome";

/** The copy of the notes folder, on the window's own computer, that takes over the routines. */
interface MoveRoutinesTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly routinesRunner: MajordomeRoutinesRunner;
}

export function MoveRoutinesDialog({
  vault,
  onClose,
}: {
  readonly vault: MoveRoutinesTarget | null;
  readonly onClose: () => void;
}) {
  return (
    <AlertDialog
      open={vault !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {vault ? (
        <MoveRoutinesDialogPopup
          key={`${vault.environmentId}:${vault.projectId}`}
          vault={vault}
          onClose={onClose}
        />
      ) : null}
    </AlertDialog>
  );
}

/** Mounted once, in the app's frame: the question behind the notice's "Use this computer". */
export function TakeOverHere() {
  const [target, setTarget] = useAtom(takeOverHereAtom);
  return (
    <MoveRoutinesDialog
      vault={target === null ? null : { ...target, routinesRunner: "another-server" }}
      onClose={() => setTarget(null)}
    />
  );
}

function MoveRoutinesDialogPopup({
  vault,
  onClose,
}: {
  readonly vault: MoveRoutinesTarget;
  readonly onClose: () => void;
}) {
  const runHere = useAtomCommand(majordomeEnvironment.runRoutinesHere, {
    label: "run routines here",
  });
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    const result = await runHere({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not move routines here",
          description: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      toastManager.add({ type: "success", title: "Routines now run on this computer" });
    }
    onClose();
  };

  return (
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>Move routines to this computer?</AlertDialogTitle>
        <AlertDialogDescription>
          Your routines for {vault.title}, and digesting new files in your inbox, will run on this
          computer from now on, and new conversations are kept here.
          {vault.routinesRunner === "another-server"
            ? " The other computer stops running them once it gets your latest notes."
            : ""}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
          Cancel
        </AlertDialogClose>
        <Button disabled={busy} onClick={() => void confirm()}>
          {busy && <Spinner size="sm" />}
          Move routines here
        </Button>
      </AlertDialogFooter>
    </AlertDialogPopup>
  );
}
