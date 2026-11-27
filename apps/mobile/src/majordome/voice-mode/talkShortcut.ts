import * as QuickActions from "expo-quick-actions";
import { Platform } from "react-native";

import { talkShortcutAction } from "../../features/shortcuts/appShortcuts";
import { offerTalkShortcut } from "../../features/shortcuts/appShortcutsRuntime";
import { appAtomRegistry } from "../../state/atom-registry";
import { voiceModeAvailableAtom } from "./availability";

/**
 * Puts "Talk" on the app icon's menu while this phone can talk with the assistant. It is the
 * iPhone's only shortcut; Android's list also holds its recent chats, so its own runtime
 * publishes it.
 */
export function installTalkShortcut(): () => void {
  return appAtomRegistry.subscribe(
    voiceModeAvailableAtom,
    (available) => {
      if (Platform.OS === "android") offerTalkShortcut(available);
      else void QuickActions.setItems(available ? [talkShortcutAction()] : []);
    },
    { immediate: true },
  );
}
