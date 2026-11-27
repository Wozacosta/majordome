import type { ReactNode } from "react";

import { SettingsPageContainer, SettingsSearchTarget } from "../settings/settingsLayout";
import { type SettingsSearchItemId, useSearchableSetting } from "../settings/settingsSearch";
import type { WorkspacePageWidth } from "../WorkspacePageContainer";
import { PageOutline } from "./PageOutline";
import { PageHeader } from "./paper";

/** A Majordome screen shown as a settings page. A search result for it lands on its top. */
export function MajordomeSettingsPage({
  searchId,
  width,
  title,
  back,
  intro,
  action,
  outline = true,
  children,
}: {
  readonly searchId: SettingsSearchItemId;
  readonly width?: WorkspacePageWidth;
  /** For a page under the one the search knows: its own title, and the way back above it. */
  readonly title?: ReactNode;
  readonly back?: ReactNode;
  /** One sentence under the title, only where it helps a decision. */
  readonly intro?: ReactNode;
  readonly action?: ReactNode;
  /** False where the page shows one computer at a time, which already keeps it short. */
  readonly outline?: boolean;
  readonly children: ReactNode;
}) {
  const target = useSearchableSetting()(searchId);
  return (
    <SettingsPageContainer {...(width ? { width } : {})}>
      {/* The page is the destination, so no focus ring around all of it. */}
      <SettingsSearchTarget {...target} className="outline-none">
        {/* Without it, a search jump would center the whole page instead of its top. */}
        <span data-settings-scroll-target aria-hidden className="block" />
        {back ? <div className="mb-3 text-sm text-muted-foreground">{back}</div> : null}
        <PageHeader title={title ?? target.title} intro={intro} action={action} />
        {outline ? <PageOutline className="mt-4" /> : null}
        {children}
      </SettingsSearchTarget>
    </SettingsPageContainer>
  );
}
