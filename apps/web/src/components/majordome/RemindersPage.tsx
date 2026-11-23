import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";

import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { majordomeEnvironment } from "../../state/majordome";
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
import { machineInSentence } from "./brains.logic";
import { NOTIFICATIONS_ANCHOR } from "./phone.logic";
import { ReminderRow } from "./RoutinesPage";
import type { MajordomeVault } from "./topics.logic";
import { useMachineNames } from "./useMachineNames";
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
                  : "What Majordome will remind you of. To add one, ask in any chat, such as “remind me on Friday at 9 to call the bank”."
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
  const { machineOf } = useMachineNames();
  // A reminder is announced by the computer it was asked on, so each one's devices count.
  const computers = [...new Set(reminders.map((item) => item.environmentId))];
  return (
    <>
      {computers.map((environmentId) => (
        <NoNotificationsLine
          key={environmentId}
          environmentId={environmentId}
          machine={computers.length > 1 ? machineOf(environmentId) : null}
        />
      ))}
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

/** Said while a computer has reminders coming and no device to announce them on. */
function NoNotificationsLine({
  environmentId,
  machine,
}: {
  readonly environmentId: EnvironmentId;
  /** The computer's name, when reminders wait on several. */
  readonly machine: string | null;
}) {
  const result = useAtomValue(majordomeEnvironment.pushDevices({ environmentId, input: {} }));
  const devices = AsyncResult.getOrElse(result, () => null)?.devices;
  if (devices === undefined || devices.length > 0) return null;
  return (
    <StatusLine tone="warning" className="mt-3 py-2.5" data-reminders-unannounced>
      No phone or computer gets notifications
      {machine === null ? "" : ` from ${machineInSentence(machine)}`} yet, so reminders only appear
      in the chat.{" "}
      <Link
        to="/settings/phone"
        hash={NOTIFICATIONS_ANCHOR}
        className="rounded-sm underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        Turn on notifications
      </Link>
    </StatusLine>
  );
}
