import type { ReactNode } from "react";

import { SettingsPageContainer, SettingsSearchTarget } from "../settings/settingsLayout";
import { searchableSetting, type SettingsSearchItemId } from "../settings/settingsSearch";
import type { WorkspacePageWidth } from "../WorkspacePageContainer";

/** A Majordome screen shown as a settings page. A search result for it lands on its top. */
export function MajordomeSettingsPage({
  searchId,
  width,
  children,
}: {
  readonly searchId: SettingsSearchItemId;
  readonly width?: WorkspacePageWidth;
  readonly children: ReactNode;
}) {
  return (
    <SettingsPageContainer {...(width ? { width } : {})}>
      <SettingsSearchTarget {...searchableSetting(searchId)}>
        {/* Without it, a search jump would center the whole page instead of its top. */}
        <span data-settings-scroll-target aria-hidden className="block" />
        <div className="flex flex-col gap-6">{children}</div>
      </SettingsSearchTarget>
    </SettingsPageContainer>
  );
}
