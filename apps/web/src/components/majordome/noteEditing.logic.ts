/**
 * How a note is edited in place: typing becomes a draft, the draft is saved once typing pauses,
 * and a save the server refuses (the file changed underneath) waits for the owner to choose.
 */

/** How long typing pauses before the note is saved. */
export const NOTE_SAVE_DELAY_MS = 800;

export type NoteSaveOutcome = "saved" | "interrupted" | { readonly problem: string };

export interface NoteEditingView {
  /** What was typed and is not on disk yet; null when the editor shows the file as it is. */
  readonly draft: string | null;
  /** The stale file content a finished save is still waiting to see replaced. */
  readonly settling: string | null | undefined;
  /** Why the last save did not go through, in words for the owner. */
  readonly problem: string | null;
}

export const NOTE_EDITING_IDLE: NoteEditingView = {
  draft: null,
  settling: undefined,
  problem: null,
};

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
  /** Saves what is typed now, without waiting for the pause. True when nothing is left unsaved. */
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
}): NoteEditing {
  let view = NOTE_EDITING_IDLE;
  let draft: string | null = null;
  let base: string | null = null;
  let saving = false;
  let blocked = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const show = (patch: Partial<NoteEditingView>) => {
    view = { ...view, ...patch };
    input.publish(view);
  };

  const flush = async (): Promise<boolean> => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const content = draft;
    if (content === null) return true;
    if (saving || blocked) return false;
    saving = true;
    const startedFrom = base;
    const outcome = await input.save(content, startedFrom);
    saving = false;
    if (outcome === "interrupted") return false;
    if (outcome !== "saved") {
      blocked = true;
      show({ problem: outcome.problem });
      return false;
    }
    base = content;
    if (draft !== content) return flush();
    draft = null;
    show(content === startedFrom ? { draft: null } : { draft: null, settling: startedFrom });
    return true;
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
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void flush(), NOTE_SAVE_DELAY_MS);
    },
    flush,
    retry: () => {
      blocked = false;
      show({ problem: null });
      void flush();
    },
    resolve: (keepMine) => {
      blocked = false;
      show({ problem: null });
      if (keepMine) {
        base = input.disk();
        void flush();
      } else {
        draft = null;
        show({ draft: null });
      }
    },
  };
}
