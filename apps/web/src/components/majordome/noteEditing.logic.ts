/**
 * How a note is edited in place: typing becomes a draft, the draft is saved once typing pauses,
 * and a save the server refuses (the file changed underneath) waits for the owner to choose.
 */

/** How long typing pauses before the note is saved. */
export const NOTE_SAVE_DELAY_MS = 800;

export type NoteSaveOutcome =
  | "saved"
  | "interrupted"
  | {
      readonly problem: string;
      /** The note was changed somewhere else, so the same save again would be refused again. */
      readonly conflict: boolean;
    };

export interface NoteEditingView {
  /** What was typed and is not on disk yet; null when the editor shows the file as it is. */
  readonly draft: string | null;
  /** The stale file content a finished save is still waiting to see replaced. */
  readonly settling: string | null | undefined;
  /** Why the last save did not go through, in words for the owner. */
  readonly problem: string | null;
  /** True when that save was refused because the note was changed somewhere else. */
  readonly conflict: boolean;
}

export const NOTE_EDITING_IDLE: NoteEditingView = {
  draft: null,
  settling: undefined,
  problem: null,
  conflict: false,
};

/** Writing a save could not put on disk, kept so that leaving the note does not lose it. */
export interface KeptNoteDraft {
  readonly draft: string;
  readonly base: string | null;
  readonly problem: string | null;
  readonly conflict: boolean;
}

/** How a note opens: as the file reads, or on the writing kept from the last time it was open. */
export function noteEditingStart(kept: KeptNoteDraft | null): NoteEditingView {
  return kept === null
    ? NOTE_EDITING_IDLE
    : { draft: kept.draft, settling: undefined, problem: kept.problem, conflict: kept.conflict };
}

/** True while the editor's text must not be replaced by the file's. */
export function isNoteHeld(view: NoteEditingView, disk: string | null): boolean {
  return view.draft !== null || (view.settling !== undefined && view.settling === disk);
}

export function noteSaveStatus(view: NoteEditingView): string {
  if (view.problem !== null) return "Not saved";
  if (view.draft !== null) return "Saving…";
  return view.settling !== undefined ? "Saved to your notes" : "";
}

export interface NoteEditing {
  readonly change: (text: string) => void;
  /**
   * Saves what is typed now, without waiting for the pause, and waits for a save already on its
   * way. True when nothing is left unsaved.
   */
  readonly flush: () => Promise<boolean>;
  /** After a save failed for a passing reason, such as a lost connection: the same save again. */
  readonly retry: () => void;
  /** After a save was refused: write over the file as it now is, or take the file's version. */
  readonly resolve: (keepMine: boolean) => void;
}

export function createNoteEditing(input: {
  /** The note as it is on disk now; null when there is no file yet. */
  readonly disk: () => string | null;
  /** `base` is the file content the edit started from. */
  readonly save: (content: string, base: string | null) => Promise<NoteSaveOutcome>;
  readonly publish: (view: NoteEditingView) => void;
  /** What `keep` last held for this note. */
  readonly kept?: KeptNoteDraft | null;
  /** Told what a failed save left unsaved, and null once nothing is. Outlives the editor. */
  readonly keep?: (kept: KeptNoteDraft | null) => void;
}): NoteEditing {
  const kept = input.kept ?? null;
  let view = noteEditingStart(kept);
  let draft = kept?.draft ?? null;
  let base = kept?.base ?? null;
  let blocked = kept !== null && kept.problem !== null;
  let failed = kept !== null;
  let inFlight: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const show = (patch: Partial<NoteEditingView>) => {
    view = { ...view, ...patch };
    input.publish(view);
  };

  const remember = () =>
    input.keep?.(
      draft !== null && failed
        ? { draft, base, problem: view.problem, conflict: view.conflict }
        : null,
    );

  const save = async (content: string): Promise<boolean> => {
    const startedFrom = base;
    failed = false;
    remember();
    const outcome = await input.save(content, startedFrom);
    if (outcome !== "saved") {
      failed = true;
      if (outcome !== "interrupted") {
        blocked = true;
        show(outcome);
      }
      remember();
      return false;
    }
    base = content;
    if (draft !== null && draft !== content) return save(draft);
    draft = null;
    show(content === startedFrom ? { draft: null } : { draft: null, settling: startedFrom });
    return true;
  };

  const flush = (): Promise<boolean> => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (draft === null) return Promise.resolve(true);
    if (inFlight !== null) return inFlight;
    if (blocked) return Promise.resolve(false);
    const running = save(draft).finally(() => {
      inFlight = null;
    });
    inFlight = running;
    return running;
  };

  return {
    change: (text) => {
      if (draft === null) {
        const disk = input.disk();
        // Until a saved note is read again, the file holds what was saved, not what `disk` shows.
        const onDisk = view.settling !== undefined && view.settling === disk ? base : disk;
        if (text === (onDisk ?? "")) return;
        base = onDisk;
      }
      draft = text;
      show({ draft: text, settling: undefined });
      remember();
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void flush(), NOTE_SAVE_DELAY_MS);
    },
    flush,
    retry: () => {
      blocked = false;
      show({ problem: null, conflict: false });
      void flush();
    },
    resolve: (keepMine) => {
      blocked = false;
      show({ problem: null, conflict: false });
      if (keepMine) {
        base = input.disk();
        void flush();
      } else {
        draft = null;
        show({ draft: null });
        remember();
      }
    },
  };
}
