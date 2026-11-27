import * as QuickActions from "expo-quick-actions";
import { Platform } from "react-native";

import { talkShortcutAction } from "../../features/shortcuts/appShortcuts";
import { appAtomRegistry } from "../../state/atom-registry";
import { voiceModeAvailableAtom } from "./availability";

/**
 * Puts "Talk" on the app icon's menu while this phone can talk with the assistant. It is the
 * iPhone's only shortcut; Android's list is its recent chats and has no voice to offer yet.
 */
export function installTalkShortcut(): () => void {
  if (Platform.OS !== "ios") return () => {};
  return appAtomRegistry.subscribe(
    voiceModeAvailableAtom,
    (available) => void QuickActions.setItems(available ? [talkShortcutAction()] : []),
    { immediate: true },
  );
}
