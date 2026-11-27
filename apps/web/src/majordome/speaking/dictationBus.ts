/**
 * Dictation tells Read aloud that the microphone is about to open, so the voice is never
 * recorded into the user's own message. Kept apart from the engine so dictation imports
 * nothing heavier than this file.
 */
const listeners = new Set<() => void>();

export function notifyDictationStarted(): void {
  for (const listener of listeners) listener();
}

export function onDictationStarted(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
