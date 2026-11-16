import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  DesktopBackgroundServiceState,
  EnvironmentId,
  MajordomeBackupStatus,
  MajordomeVaultHistoryResult,
  ProjectId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { ChevronRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import {
  environmentOverviewsAtom,
  majordomeEnvironment,
  privateDocumentRequestsAtom,
  vaultBackupStatusesAtom,
  vaultHistoriesAtom,
  vaultNotesIndexStatusesAtom,
} from "../../state/majordome";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  formatDayAwareTimestamp,
  formatRelativeTimeLabel,
  formatUpcomingTimestamp,
} from "../../timestampFormat";
import { resolveVersionMismatch } from "../../versionSkew";
import { classifySecretProvider } from "../settings/SecretProviderDialog.logic";
import { secretProviderUses } from "../settings/SecretsSettings.logic";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { BackgroundServiceToggle, useBackgroundService } from "./BackgroundServiceToggle";
import { copyLabel, groupBrains, routinesMachine, runnerCopy } from "./brains.logic";
import { isUnknownRequest } from "./connections.logic";
import { buildFeedRunItems, stoppedRunKeys } from "./feed.logic";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import { useDevicePush } from "./NotificationsToggle";
import {
  accessSection,
  type Loaded,
  needsYouLines,
  notesSection,
  type OverviewLine,
  type OverviewSection,
  overviewVerdict,
  phoneSection,
  routinesSection,
  whereItRunsSection,
} from "./overview.logic";
import { EntryList, ROW_ACTION_CLASS, Section, SectionTitle, ToneDot } from "./paper";
import { readDevicePushSupport } from "./pushNotifications";
import { useMachineNames } from "./useMachineNames";

/** Whether the whole setup is healthy: one verdict, then each part's state and where to fix it. */
export function OverviewPage() {
  const { primaryEnvironmentId } = useMachineNames();
  const background = useBackgroundService();
  return (
    <MajordomeSettingsPage
      searchId="majordome-overview"
      intro="How your assistant is doing right now. Open a line to change it."
    >
      {primaryEnvironmentId === null ? (
        <Section>
          <Skeleton className="h-40 w-full" />
        </Section>
      ) : (
        <Health environmentId={primaryEnvironmentId} background={background} />
      )}
    </MajordomeSettingsPage>
  );
}

/** What a request gave, for the page's lines. An unknown request is a server from before it. */
function loaded<A, E>(result: AsyncResult.AsyncResult<A, E> | undefined): Loaded<A> {
  if (result === undefined || result._tag === "Initial") return { state: "loading" };
  if (result._tag === "Success") return { state: "ready", value: result.value };
  return isUnknownRequest(Cause.squash(result.cause))
    ? { state: "outdated" }
    : { state: "failed", message: formatEnvironmentQueryError(result.cause) };
}

function mapLoaded<A, B>(value: Loaded<A>, map: (value: A) => B): Loaded<B> {
  return value.state === "ready" ? { state: "ready", value: map(value.value) } : value;
}

interface VaultCopy {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly brainId: string | null | undefined;
  readonly backup: MajordomeBackupStatus;
  /** Null while it loads, or when its server could not give it. */
  readonly history: MajordomeVaultHistoryResult | null;
  readonly routinesRunner: MajordomeVaultHistoryResult["routinesRunner"] | null;
}

function Health({
  environmentId,
  background,
}: {
  /** The window's own server. */
  readonly environmentId: EnvironmentId;
  readonly background: DesktopBackgroundServiceState | null;
}) {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const formatAgo = (iso: string) => formatRelativeTimeLabel(iso, nowMs);

  const { environments } = useEnvironments();
  const { machineOf } = useMachineNames();
  const ordered = [
    ...environments.filter((environment) => environment.environmentId === environmentId),
    ...environments.filter((environment) => environment.environmentId !== environmentId),
  ];
  const nameOf = (id: EnvironmentId) => (ordered.length > 1 ? machineOf(id) : null);
  const connectedIds = ordered
    .filter((environment) => environment.connection.phase === "connected")
    .map((environment) => environment.environmentId);
  const isConnected = (id: EnvironmentId) => connectedIds.includes(id);
  const providers = useEnvironmentProviders();
  const servers = useAtomValue(environmentOverviewsAtom(JSON.stringify(connectedIds)));
  const serverOf = (id: EnvironmentId) => servers[connectedIds.indexOf(id)];

  const projects = useProjects().filter((project) => !project.isScratch && !project.archivedAt);
  const projectsKey = JSON.stringify(
    projects.map((project) => [project.environmentId, project.id]),
  );
  const backups = useAtomValue(vaultBackupStatusesAtom(projectsKey));
  const histories = useAtomValue(vaultHistoriesAtom(projectsKey));
  const copies: Array<VaultCopy> = [];
  let vaultsLoading = false;
  let historiesLoading = false;
  projects.forEach((project, index) => {
    // A machine that is not connected says so on its own line.
    if (!isConnected(project.environmentId)) return;
    const backup = backups[index];
    if (backup === undefined || backup._tag === "Initial") {
      vaultsLoading = true;
      return;
    }
    const status = AsyncResult.getOrElse(backup, () => null);
    if (status?.isVault !== true) return;
    const historyResult = histories[index];
    if (historyResult === undefined || historyResult._tag === "Initial") historiesLoading = true;
    const history =
      historyResult === undefined ? null : AsyncResult.getOrElse(historyResult, () => null);
    copies.push({
      environmentId: project.environmentId,
      projectId: project.id,
      title: project.title,
      brainId: status.brainId,
      backup: status,
      history,
      routinesRunner: history?.routinesRunner ?? null,
    });
  });
  const brains = groupBrains(copies, environmentId);
  const severalBrains = brains.length > 1;
  const labelOf = (copy: VaultCopy, severalCopies: boolean) =>
    copyLabel({
      title: copy.title,
      machine: severalCopies ? machineOf(copy.environmentId) : null,
      severalBrains,
    });
  const indexes = useAtomValue(
    vaultNotesIndexStatusesAtom(
      JSON.stringify(copies.map((copy) => [copy.environmentId, copy.projectId])),
    ),
  );

  const threads = useQuietThreadShells();
  const runs = buildFeedRunItems(
    threads,
    copies,
    stoppedRunKeys(
      copies.map((copy) => ({
        environmentId: copy.environmentId,
        stoppedRuns: copy.history?.stoppedRuns ?? [],
      })),
    ),
  );
  // A waiting run with an owner-only card may be asking for a private document.
  const cards = runs.flatMap((run) =>
    run.ownerCardId === null
      ? []
      : [{ run, ref: [run.vault.environmentId, run.threadId, run.ownerCardId] as const }],
  );
  const requests = useAtomValue(
    privateDocumentRequestsAtom(JSON.stringify(cards.map((card) => card.ref))),
  );
  const documentRequests = cards
    .filter((_, index) => {
      const request = requests[index];
      return request !== undefined && AsyncResult.getOrElse(request, () => null) !== null;
    })
    .map((card) => card.run);

  const [support] = useState(readDevicePushSupport);
  const push = useDevicePush(environmentId, support === "supported");
  const devices = useAtomValue(majordomeEnvironment.pushDevices({ environmentId, input: {} }));
  const phone = useAtomValue(majordomeEnvironment.phoneSetup({ environmentId, input: {} }));

  const offline = ordered
    .filter((environment) => !isConnected(environment.environmentId))
    .map((environment) => ({
      key: environment.environmentId,
      label: nameOf(environment.environmentId),
    }));
  const needsYou = needsYouLines(
    runs.map((run) => ({
      status: run.status,
      privateDocumentRequest: documentRequests.includes(run),
    })),
  );
  const where = whereItRunsSection({
    machines: ordered.map((environment) => {
      const version = environment.serverConfig?.environment.serverVersion ?? null;
      const { phase } = environment.connection;
      return {
        environmentId: environment.environmentId,
        label: nameOf(environment.environmentId),
        primary: environment.environmentId === environmentId,
        connection:
          phase === "connected"
            ? "connected"
            : phase === "connecting" || phase === "reconnecting"
              ? "connecting"
              : "disconnected",
        version,
        behind: resolveVersionMismatch(version) !== null,
      };
    }),
    background,
    formatSince: (iso) => formatDayAwareTimestamp(iso, timestampFormat, nowMs),
    runners: brains.map((brain) => ({
      key: brain.key,
      label: severalBrains ? brain.copies[0].title : null,
      runner: runnerCopy(brain).routinesRunner,
      runsOn: routinesMachine(brain, machineOf),
    })),
  });
  const routines = routinesSection({
    brains: brains.map((brain) => {
      const runner = runnerCopy(brain);
      return {
        key: brain.key,
        label: severalBrains ? runner.title : null,
        runner: { environmentId: runner.environmentId, machine: machineOf(runner.environmentId) },
        routinesStatus: runner.history?.routinesStatus,
        pausedRunsPerDay: runner.history?.pausedToday
          ? (runner.history.routineLimits?.runsPerDay ?? null)
          : null,
        limits: runner.history?.routineLimits,
        memoryOverLimit: runner.history?.memoryOverLimit,
        copies: brain.copies.map((copy) => ({
          key: `${copy.environmentId}:${copy.projectId}`,
          label: labelOf(copy, brain.copies.length > 1),
          tasks: mapLoaded(loaded(serverOf(copy.environmentId)?.tasks), (list) => ({
            tasks: list.tasks.filter((task) => task.projectId === copy.projectId),
            timeZone: list.timeZone,
          })),
        })),
      };
    }),
    loading: vaultsLoading || historiesLoading,
    formatNextRun: (iso) => formatUpcomingTimestamp(iso, timestampFormat, nowMs),
  });
  const notes = notesSection({
    copies: brains.flatMap((brain) =>
      brain.copies.map((copy) => ({
        key: `${copy.environmentId}:${copy.projectId}`,
        environmentId: copy.environmentId,
        projectId: copy.projectId,
        label: labelOf(copy, brain.copies.length > 1),
        backup: copy.backup,
        index: mapLoaded(loaded(indexes[copies.indexOf(copy)]), (result) => result.status),
      })),
    ),
    offline,
    loading: vaultsLoading,
    formatAgo,
  });
  const access = accessSection({
    machines: ordered.map((environment) => {
      const id = environment.environmentId;
      const server = serverOf(id);
      const settings = server?.settings ?? null;
      return {
        key: id,
        environmentId: id,
        label: nameOf(id),
        connected: isConnected(id),
        providers: providers.get(id) ?? null,
        secrets:
          environment.serverConfig !== null &&
          environment.serverConfig.secretProviderSettings !== true
            ? "outdated"
            : settings === null
              ? null
              : Object.entries(settings.secretProviders).map(([sourceId, config]) => {
                  const classified = classifySecretProvider(config);
                  return {
                    id: sourceId,
                    label: config.label,
                    kind: classified.kind === "supported" ? classified.definition.label : null,
                    uses: secretProviderUses(settings, sourceId).length,
                  };
                }),
        documents: loaded(server?.privateDocuments),
        pendingRequests: documentRequests.filter((run) => run.vault.environmentId === id).length,
      };
    }),
    formatAgo,
  });
  const phoneLines = phoneSection({
    support,
    thisEndpoint: push.endpoint,
    devices: mapLoaded(loaded(devices), (result) => result.devices),
    phone: loaded(phone),
  });
  const verdict = overviewVerdict(needsYou, [where, routines, notes, access, phoneLines]);

  return (
    <>
      <Section aria-label="How it is doing">
        <SectionTitle className="flex items-center gap-2.5" data-overview-verdict={verdict.tone}>
          <ToneDot tone={verdict.tone} className="size-2.5" />
          {verdict.text}
        </SectionTitle>
        {verdict.items.length > 0 ? (
          <EntryList className="mt-3" aria-label="Needs you">
            {verdict.items.map((line) => (
              <Line key={line.key} line={line} />
            ))}
          </EntryList>
        ) : null}
      </Section>
      <Lines label="Where it runs" section={where}>
        <BackgroundServiceToggle state={background} />
      </Lines>
      <Lines
        label="Routines"
        section={routines}
        action={<SectionLink to="/routines">Routines</SectionLink>}
      />
      <Lines
        label="Notes"
        section={notes}
        action={<SectionLink to="/settings/backup">Back up my brain</SectionLink>}
      />
      <Lines
        label="AI and access"
        section={access}
        // Listing connectors starts each AI's own program, so it stays on its page.
        action={<SectionLink to="/settings/connectors">Connections</SectionLink>}
      />
      <Lines label="Phone" section={phoneLines} />
    </>
  );
}

function SectionLink({
  to,
  children,
}: {
  readonly to: "/routines" | "/settings/backup" | "/settings/connectors";
  readonly children: ReactNode;
}) {
  return (
    <Link to={to} className="underline underline-offset-2">
      {children}
    </Link>
  );
}

function Lines({
  label,
  section,
  action,
  children,
}: {
  readonly label: string;
  readonly section: OverviewSection;
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <Section label={label} action={action} data-overview-section={label}>
      {section.lines.length > 0 ? (
        <EntryList aria-label={label}>
          {section.lines.map((line) => (
            <Line key={line.key} line={line} />
          ))}
        </EntryList>
      ) : null}
      {section.loading ? <Skeleton className="mt-2 h-10 w-full" /> : null}
      {children}
    </Section>
  );
}

function Line({ line }: { readonly line: OverviewLine }) {
  const words = (
    <>
      <ToneDot tone={line.tone} className="mt-1.5" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="wrap-anywhere text-foreground">{line.text}</span>
        {line.detail ? (
          <span className="text-xs wrap-anywhere text-muted-foreground">{line.detail}</span>
        ) : null}
      </span>
    </>
  );
  return (
    <li
      className="border-t border-border text-sm"
      data-overview-line={line.key}
      data-tone={line.tone}
    >
      {line.link ? (
        <Link {...line.link} className={cn(ROW_ACTION_CLASS, "flex items-start gap-2 py-3")}>
          {words}
          <ChevronRightIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      ) : (
        <div className="flex flex-wrap items-start gap-2 py-3">
          {words}
          {line.rebuild ? <RebuildNotesSearch {...line.rebuild} /> : null}
        </div>
      )}
    </li>
  );
}

/** Rebuilds a notes search that failed; the status then reads again and the line follows. */
function RebuildNotesSearch({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const canRebuild = useAtomValue(
    majordomeEnvironment.rebuildNotesIndex.permissionAtom(environmentId),
  );
  const rebuild = useAtomCommand(majordomeEnvironment.rebuildNotesIndex, {
    label: "rebuild notes search",
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  if (!canRebuild) return null;
  const run = async () => {
    setBusy(true);
    const result = await rebuild({ environmentId, input: { projectId } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not rebuild the notes search",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <Button size="xs" variant="outline" disabled={busy} onClick={() => void run()}>
      {busy ? <Spinner size="sm" /> : null}
      Rebuild
    </Button>
  );
}
