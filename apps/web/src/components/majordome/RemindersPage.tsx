import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  EntryList,
  ListSkeleton,
  LoadFailed,
  Muted,
  PageHeader,
  Section,
  StatusLine,
} from "./paper";
import { ReminderRow } from "./RoutinesPage";
import type { MajordomeVault } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useVaultRoutines } from "./useVaultRoutines";

/** What Majordome will remind the person of, soonest first. Reminders are asked for in a conversation. */
export function RemindersPage() {
  const { activeVault, loading } = useMajordomeVaults();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border" />
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col px-5 pt-6 pb-12 sm:px-6">
            <PageHeader
              title="Reminders"
              intro={
                activeVault === null && !loading
                  ? "Open a notes folder to give it reminders."
                  : "What Majordome will remind you of. To add one, ask in any conversation, such as “remind me on Friday at 9 to call the bank”."
              }
            />
            {activeVault === null ? null : (
              <VaultReminders key={activeVault.key} vault={activeVault} />
            )}
          </div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function VaultReminders({ vault }: { readonly vault: MajordomeVault }) {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const { reminders, runnerUnreachable, loading, remindersFailed, retry } = useVaultRoutines(vault);
  return (
    <>
      {runnerUnreachable ? (
        <StatusLine tone="warning" className="mt-3 py-2.5">
          Another of your computers can't be reached from this window right now. Reminders you asked
          for there aren't listed here.
        </StatusLine>
      ) : null}
      <Section label="Coming up">
        {reminders.length > 0 ? (
          <EntryList aria-label="Reminders">
            {reminders.map((item) => (
              <ReminderRow key={item.key} item={item} nowMs={nowMs} />
            ))}
          </EntryList>
        ) : loading ? (
          <ListSkeleton rows={2} />
        ) : remindersFailed ? (
          <LoadFailed onRetry={retry}>Couldn't load your reminders.</LoadFailed>
        ) : (
          <Muted className="border-t border-border py-3">Nothing coming up.</Muted>
        )}
      </Section>
    </>
  );
}
