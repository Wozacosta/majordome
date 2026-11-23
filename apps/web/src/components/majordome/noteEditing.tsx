import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { MajordomeDailyNoteError, MajordomeNoteError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import {
  createNoteEditing,
  isNoteHeld,
  type KeptNoteDraft,
  noteEditingStart,
  type NoteEditingView,
  type NoteSaveOutcome,
  noteSaveStatus,
} from "./noteEditing.logic";

/**
 * Writing that could not be saved, by note, for as long as the app stays open: leaving a note
 * with the "Not saved" banner up brings the same text and banner back when it is opened again.
 */
const keptDrafts = new Map<string, KeptNoteDraft>();

export function noteDraftKey(
  vault: { readonly environmentId: string; readonly projectId: string },
  path: string,
): string {
  return `${vault.environmentId}:${vault.projectId}:${path}`;
}

export function hasKeptNoteDraft(draftKey: string): boolean {
  return keptDrafts.has(draftKey);
}

const isNoteError = Schema.is(Schema.Union([MajordomeNoteError, MajordomeDailyNoteError]));

function saveProblem(error: unknown): Exclude<NoteSaveOutcome, string> {
  if (isNoteError(error)) {
    return { problem: error.message, conflict: error.reason === "changed" };
  }
  return { problem: "Majordome could not be reached.", conflict: false };
}

/**
 * One note edited in place and saved as it is typed. `disk` is the note as last read (null when
 * there is no file yet); `save` writes `content` over a file that still reads as `base`.
 */
export function useNoteEditing(input: {
  /** Names the note among all notes, so writing left unsaved is found again. */
  readonly draftKey: string;
  readonly disk: string | null;
  readonly save: (
    content: string,
    base: string | null,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
}) {
  const latest = useStableCallback(() => input);
  const [kept] = useState(() => keptDrafts.get(input.draftKey) ?? null);
  const [view, setView] = useState(() => noteEditingStart(kept));
  const draftKey = useStableCallback(() => input.draftKey);
  const leaving = useRef({ left: false, warned: false });
  const warn = useStableCallback(() => {
    if (leaving.current.warned) return;
    leaving.current.warned = true;
    toastManager.add({
      type: "warning",
      title: "Your changes are not saved yet",
      description: "They are kept for now. Open the note again to finish saving them.",
    });
  });
  const keep = useStableCallback((draft: KeptNoteDraft | null) => {
    if (draft === null) {
      keptDrafts.delete(input.draftKey);
      return;
    }
    const known = keptDrafts.has(input.draftKey);
    keptDrafts.set(input.draftKey, draft);
    // A save that fails after the note was left has no banner to show it.
    if (leaving.current.left && !known) warn();
  });
  const [editing] = useState(() =>
    createNoteEditing({
      disk: () => latest().disk,
      save: async (content, base) => {
        const outcome = await latest().save(content, base);
        if (outcome._tag !== "Failure") return "saved";
        if (isAtomCommandInterrupted(outcome)) return "interrupted";
        return saveProblem(squashAtomCommandFailure(outcome));
      },
      publish: setView,
      kept,
      keep,
    }),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opening the note saves what an interrupted save left, and leaving it saves what the pause had not saved yet
  useEffect(() => {
    const state = leaving.current;
    state.left = false;
    state.warned = false;
    void editing.flush();
    return () => {
      state.left = true;
      void editing.flush();
      // Checked a moment later: a development remount is not the note being left.
      queueMicrotask(() => {
        if (state.left && keptDrafts.has(draftKey())) warn();
      });
    };
  }, [editing, draftKey, warn]);

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
  const { problem, conflict } = editing.view;
  if (problem === null) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm",
        className,
      )}
    >
      {conflict ? (
        <>
          <span className="min-w-0 flex-1">
            This note was changed somewhere else while you were writing.
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => editing.resolve(false)}>
            Use the other version
          </Button>
          <Button type="button" size="sm" onClick={() => editing.resolve(true)}>
            Keep mine (replaces the other change)
          </Button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1">Not saved. {problem}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => editing.resolve(false)}>
            Discard my changes
          </Button>
          <Button type="button" size="sm" onClick={editing.retry}>
            Try again
          </Button>
        </>
      )}
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
