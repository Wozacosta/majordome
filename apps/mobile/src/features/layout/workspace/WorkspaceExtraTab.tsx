import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { UsageRouteScreen } from "../../usage/UsageRouteScreen";
import { isMajordome } from "../../../majordome/env";
import { MajordomeTodayScreen } from "../../../majordome/TodayScreen";

export function WorkspaceExtraTab(_props: { tab: Extract<NavigationTab, "usage"> }) {
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      {/* Majordome has no usage page; its Today page takes this one-page tab. */}
      {isMajordome ? <MajordomeTodayScreen /> : <UsageRouteScreen workspace />}
    </>
  );
}
