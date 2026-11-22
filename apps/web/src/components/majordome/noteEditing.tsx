import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  createNoteEditing,
  isNoteHeld,
  NOTE_EDITING_IDLE,
  type NoteEditingView,
  noteSaveStatus,
} from "./noteEditing.logic";

/**
 * One note edited in place and saved as it is typed. `disk` is the note as last read (null when
 * there is no file yet); `save` writes `content` over a file that still reads as `base`.
 */
export function useNoteEditing(input: {
  readonly disk: string | null;
  readonly save: (
    content: string,
    base: string | null,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
}) {
  const latest = useStableCallback(() => input);
  const [view, setView] = useState(NOTE_EDITING_IDLE);
  const [editing] = useState(() =>
    createNoteEditing({
      disk: () => latest().disk,
      save: async (content, base) => {
        const outcome = await latest().save(content, base);
        if (outcome._tag !== "Failure") return "saved";
        if (isAtomCommandInterrupted(outcome)) return "interrupted";
        const error = squashAtomCommandFailure(outcome);
        return { problem: error instanceof Error ? error.message : String(error) };
      },
      publish: setView,
    }),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- leaving the note saves what the pause had not saved yet
  useEffect(
    () => () => {
      void editing.flush();
    },
    [editing],
  );

  return { ...editing, view, held: isNoteHeld(view, input.disk) };
}

/** Shown while a save did not go through, with the ways out of it. */
export function NoteSaveProblem({
  editing,
  className,
}: {
  readonly editing: ReturnType<typeof useNoteEditing>;
  readonly className?: string;
}) {
  if (editing.view.problem === null) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm",
        className,
      )}
    >
      <span className="min-w-0 flex-1">Not saved. {editing.view.problem}</span>
      <Button type="button" size="sm" variant="ghost" onClick={editing.retry}>
        Try again
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => editing.resolve(false)}>
        Discard my changes
      </Button>
      <Button type="button" size="sm" onClick={() => editing.resolve(true)}>
        Keep my version
      </Button>
    </div>
  );
}

export function NoteSaveStatus({
  view,
  className,
}: {
  readonly view: NoteEditingView;
  readonly className?: string;
}) {
  return (
    <p
      className={cn("min-h-4 text-right text-xs text-muted-foreground", className)}
      aria-live="polite"
    >
      {noteSaveStatus(view)}
    </p>
  );
}
