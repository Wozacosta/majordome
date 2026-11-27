import { isCommandPaletteOpen } from "~/commandPaletteBus";

import { voiceMode } from "./platform";

const within = (target: EventTarget | null, selector: string) =>
  target instanceof Element && target.closest(selector) !== null;

/**
 * The conversation's keys: Escape and Space interrupt the assistant, Return sends what was
 * said, Escape otherwise ends the conversation. Other typing is dropped while the composer is
 * covered, so it does not pile up in a draft nobody sees.
 */
function onKeyDown(event: KeyboardEvent) {
  const runtime = voiceMode.get();
  if (!runtime) return;
  const { chatKey, state } = runtime.getSnapshot();
  // While an answer is wanted the keys belong to the card that asks for it.
  if (chatKey === null || state === "needs-you") return;
  if (event.defaultPrevented || event.isComposing || isCommandPaletteOpen()) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const { target } = event;
  if (
    (target instanceof HTMLElement && target.isContentEditable) ||
    within(target, "input, textarea, select, [role=dialog], [role=menu], [role=listbox]")
  ) {
    return;
  }
  const talking = state === "thinking" || state === "speaking";
  if (event.key === "Escape") {
    if (talking) runtime.interrupt();
    else runtime.close();
  } else if (within(target, "button, a, [role=button]")) {
    return;
  } else if (event.key === " ") {
    if (talking && !event.repeat) runtime.interrupt();
  } else if (event.key === "Enter") {
    if (state === "listening" && !event.repeat) runtime.sendNow();
  } else if (event.key.length !== 1) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

// Registered as the module loads, ahead of the chat's own key handling, which would otherwise
// type these keys into the composer.
if (typeof window !== "undefined") window.addEventListener("keydown", onKeyDown, true);
