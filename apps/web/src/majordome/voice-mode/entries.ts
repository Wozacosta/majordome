/** A composer on screen whose chat can be talked in right now. */
export interface VoiceModeEntry {
  readonly chatKey: string;
  /** Starts talking, or opens the setup the chat's dictation still needs. Call from a click or key press. */
  readonly start: () => void;
}

const entries: VoiceModeEntry[] = [];
const listeners = new Set<() => void>();

const changed = () => {
  for (const listener of listeners) listener();
};

/** The composer says its chat can be talked in; the returned function says it no longer can. */
export function offerVoiceMode(entry: VoiceModeEntry): () => void {
  entries.push(entry);
  changed();
  return () => {
    const index = entries.indexOf(entry);
    if (index === -1) return;
    entries.splice(index, 1);
    changed();
  };
}

/** Where the shortcut and the command palette start talking: the composer shown last. */
export const voiceModeEntries = {
  latest: (): VoiceModeEntry | null => entries.at(-1) ?? null,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
