import { useGT } from "gt-react-native";

import { isMajordome } from "../../../majordome/env";
import { useAdaptiveWorkspaceLayout } from "../adaptive-workspace-context";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";

/** What the compose button starts on the selected tab; null where the tab has nothing to start. */
export function useWorkspaceCompose() {
  const gt = useGT();
  const workspace = useWorkspaceTabs();
  const { startNewTask } = useAdaptiveWorkspaceLayout();
  const tab = workspace?.state.selectedTab;
  // Majordome's Today page sits in the usage slot and starts chats too.
  const composes = tab === "threads" || (isMajordome && tab === "usage");
  if (!workspace || workspace.settingsOpen || !composes) return null;
  return { label: gt("New chat"), onPress: startNewTask } as const;
}
