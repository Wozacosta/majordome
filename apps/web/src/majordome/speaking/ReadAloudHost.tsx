import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useLocale } from "gt-react";
import { lazy, Suspense, useEffect } from "react";

import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { useThreadRouteRef } from "~/hooks/useThreadRouteTarget";
import { resolveShortcutCommand } from "~/keybindings";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryServerKeybindingsAtom } from "~/state/server";

import { setReadAloudAppLanguage } from "./appLanguage";
import type { ReadAloudRuntime } from "./runtime";
import { useReadAloud } from "./useReadAloud";

const VoiceDownloadDialog = lazy(() =>
  import("./VoiceDownloadDialog").then((module) => ({ default: module.VoiceDownloadDialog })),
);

/** Mounted once: the download dialog, the shortcut, and silence when the chat is left. */
export function ReadAloudHost() {
  const runtime = useReadAloud();
  return runtime ? <Host runtime={runtime} /> : null;
}

function Host({ runtime }: { readonly runtime: ReadAloudRuntime }) {
  const locale = useLocale();
  const routeRef = useThreadRouteRef();
  const chatKey = routeRef ? scopedThreadKey(routeRef) : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the voice plays outside React; a reply of the chat that was left must fall silent
  useEffect(() => runtime.showChat(chatKey), [runtime, chatKey]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener for the read aloud shortcut
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
      if (command !== "chat.readAloud") return;
      event.preventDefault();
      event.stopPropagation();
      setReadAloudAppLanguage(locale);
      void runtime.toggleLatest();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [runtime, locale]);

  return (
    <Suspense fallback={null}>
      <VoiceDownloadDialog runtime={runtime} />
    </Suspense>
  );
}
