import { useNavigation, useRoute } from "@react-navigation/native";
import { Platform } from "react-native";

import { resetAndroidWorkspace } from "../../lib/android-workspace-navigation";
import { useHardwareBack } from "../../lib/backHandler";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { isMajordome } from "../../majordome/env";

/**
 * The page's Back action, or undefined for the first page beside the Settings list on wide
 * Android: that page roots the detail column, so Back leaves Settings rather than emptying it.
 */
export function useSettingsPageBack() {
  const navigation = useNavigation();
  const route = useRoute();
  const { layout } = useAdaptiveWorkspaceLayout();
  const routes = navigation.getState()?.routes ?? [];
  const below = routes[routes.findIndex((candidate) => candidate.key === route.key) - 1];
  // Majordome's Settings list is a page of its own under this one, so Back returns to it.
  const columnRoot =
    !isMajordome && Platform.OS === "android" && layout.usesSplitView && below?.name === "Settings";
  useHardwareBack(columnRoot, () => {
    resetAndroidWorkspace(navigation);
    return true;
  });
  return columnRoot ? undefined : () => navigation.goBack();
}
