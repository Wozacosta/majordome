import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { UsageRouteScreen } from "../../usage/UsageRouteScreen";
import { isMajordome } from "../../../majordome/env";
import { MajordomeTodayScreen } from "../../../majordome/TodayScreen";
import { WorkflowsScreen } from "../../workflows/WorkflowsScreen";

export function WorkspaceExtraTab(props: { tab: Extract<NavigationTab, "usage" | "workflows"> }) {
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      {/* Majordome has no usage page; its Today page takes this one-page tab. */}
      {props.tab === "workflows" ? (
        <WorkflowsScreen />
      ) : isMajordome ? (
        <MajordomeTodayScreen />
      ) : (
        <UsageRouteScreen workspace />
      )}
    </>
  );
}
