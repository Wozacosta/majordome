import { useGT } from "gt-react";
import { useEffect, useSyncExternalStore } from "react";

import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { resolveShortcutCommand } from "~/keybindings";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryServerKeybindingsAtom } from "~/state/server";

import { voiceModeEntries } from "./entries";
import { voiceMode } from "./platform";
import { useVoiceMode, useVoiceModeSnapshot } from "./useVoiceMode";

/** Starts talking in the chat on screen, or ends the conversation that is going on. */
function toggleVoiceMode(): boolean {
  const runtime = voiceMode.get();
  if (!runtime) return false;
  if (runtime.getSnapshot().chatKey !== null) {
    runtime.close();
    return true;
  }
  const entry = voiceModeEntries.latest();
  entry?.start();
  return entry !== null;
}

/** The command palette's entry: start a voice chat here, or end the one going on. */
export function useVoiceModeCommand(): {
  readonly title: string;
  readonly run: () => void;
} | null {
  const gt = useGT();
  const runtime = useVoiceMode();
  const talking = useVoiceModeSnapshot(runtime).chatKey !== null;
  const offered = useSyncExternalStore(
    voiceModeEntries.subscribe,
    () => voiceModeEntries.latest() !== null,
    () => false,
  );
  if (!runtime || (!talking && !offered)) return null;
  return {
    title: talking ? gt("End voice chat") : gt("Start voice chat"),
    run: () => void toggleVoiceMode(),
  };
}

/** Mounted once: the shortcut that starts and ends a voice chat. */
export function VoiceModeShortcut() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener for the voice chat shortcut
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || isCommandPaletteOpen()) {
        return;
      }
      const command = resolveShortcutCommand(
        event,
        appAtomRegistry.get(primaryServerKeybindingsAtom),
        { context: { terminalFocus: isTerminalFocused() } },
      );
      if (command !== "chat.voiceMode" || !toggleVoiceMode()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  return null;
}
