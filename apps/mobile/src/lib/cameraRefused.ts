import { msg } from "gt-react-native";
import { Linking } from "react-native";

import * as Dialog from "../components/ui/Dialog";
import { m } from "../i18n/messages";

/** The phone no longer asks once the camera was refused: only its Settings can allow it. */
export function showCameraRefused(): void {
  Dialog.alert(m(msg("Majordome isn't allowed to use the camera.")), undefined, [
    { text: m(msg("Not now")), style: "cancel" },
    { text: m(msg("Open Settings")), onPress: () => void Linking.openSettings() },
  ]);
}
