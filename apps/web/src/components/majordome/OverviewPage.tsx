import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  MajordomeBackupStatus,
  MajordomeRoutinesRunner,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import {
  BrainIcon,
  ChevronRightIcon,
  CloudUploadIcon,
  LaptopIcon,
  type LucideIcon,
  MonitorSmartphoneIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import {
  majordomeEnvironment,
  vaultBackupStatusesAtom,
  vaultHistoriesAtom,
} from "../../state/majordome";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { formatRelativeTimeLabel, formatUpcomingTimestamp } from "../../timestampFormat";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { buildFeedRunItems } from "./feed.logic";
import { notesLink, type NotesVault } from "./notes.logic";
import { useDevicePush } from "./NotificationsToggle";
import {
  backupBox,
  brainBox,
  devicesBox,
  majordomeBox,
  OVERVIEW_TONE_BOX_CLASS,
  OVERVIEW_TONE_DOT_CLASS,
  type OverviewBox,
} from "./overview.logic";
import { readDevicePushSupport } from "./pushNotifications";

/** A live map of the setup: devices, this computer's Majordome, each brain and its backups. */
export function OverviewPage() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Overview</h1>
        </WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="expanded">
            <p className="text-sm text-muted-foreground">
              How your Majordome fits together, as it is right now. Open a box to change it.
            </p>
            {environmentId === null ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <Diagram environmentId={environmentId} />
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function Diagram({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const formatAgo = (iso: string) => formatRelativeTimeLabel(iso, nowMs);
  const formatNextRun = (iso: string) => formatUpcomingTimestamp(iso, timestampFormat, nowMs);

  const [support] = useState(readDevicePushSupport);
  const push = useDevicePush(environmentId, support === "supported");
  const devicesResult = useAtomValue(
    majordomeEnvironment.pushDevices({ environmentId, input: {} }),
  );
  const phoneResult = useAtomValue(majordomeEnvironment.phoneSetup({ environmentId, input: {} }));
  const { environments } = useEnvironments();
  const connected =
    environments.find((environment) => environment.environmentId === environmentId)?.connection
      .phase === "connected";
  const providers = useEnvironmentProviders().get(environmentId) ?? null;

  const devices = devicesBox({
    support,
    thisEndpoint: push.endpoint,
    devices: AsyncResult.getOrElse(devicesResult, () => null)?.devices ?? null,
  });
  const majordome = majordomeBox({
    connected,
    providers,
    phone: AsyncResult.getOrElse(phoneResult, () => null),
  });

  const { vaults, loading } = useOverviewVaults();
  const threads = useQuietThreadShells();
  const runs = buildFeedRunItems(threads, vaults);

  return (
    <div className="flex flex-col items-stretch md:flex-row md:items-start" data-overview-diagram>
      <div className="md:w-64 md:shrink-0">
        <BoxCard box={devices} icon={MonitorSmartphoneIcon} />
      </div>
      <Connector label="notifies" />
      <div className="md:w-72 md:shrink-0">
        <BoxCard box={majordome} icon={LaptopIcon} />
      </div>
      <Connector label="looks after" />
      {/* Each brain's parts stack here; later parts (secrets, documents, search) join them. */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {vaults.length === 0 ? (
          loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No notes folder yet</EmptyTitle>
                <EmptyDescription>
                  Open your notes folder in Majordome to see it here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          vaults.map((vault) => (
            <BrainColumn
              key={`${vault.environmentId}:${vault.projectId}`}
              vault={vault}
              waiting={
                runs.filter(
                  (run) => run.vault.projectId === vault.projectId && run.status === "waiting",
                ).length
              }
              failed={
                runs.filter(
                  (run) => run.vault.projectId === vault.projectId && run.status === "failed",
                ).length
              }
              formatAgo={formatAgo}
              formatNextRun={formatNextRun}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface OverviewVault extends NotesVault {
  readonly runner: MajordomeRoutinesRunner | null;
  readonly backup: MajordomeBackupStatus;
}

function useOverviewVaults(): {
  readonly vaults: ReadonlyArray<OverviewVault>;
  readonly loading: boolean;
} {
  const projects = useProjects().filter((project) => !project.isScratch && !project.archivedAt);
  const key = JSON.stringify(projects.map((project) => [project.environmentId, project.id]));
  const backups = useAtomValue(vaultBackupStatusesAtom(key));
  const histories = useAtomValue(vaultHistoriesAtom(key));
  const vaults: Array<OverviewVault> = [];
  let loading = false;
  projects.forEach((project, index) => {
    const backup = backups[index];
    if (backup === undefined || backup._tag === "Initial") loading = true;
    const status = backup === undefined ? null : AsyncResult.getOrElse(backup, () => null);
    if (status?.isVault !== true) return;
    const history = histories[index];
    vaults.push({
      environmentId: project.environmentId,
      projectId: project.id,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      runner:
        history === undefined
          ? null
          : (AsyncResult.getOrElse(history, () => null)?.routinesRunner ?? null),
      backup: status,
    });
  });
  return { vaults, loading };
}

function BrainColumn({
  vault,
  waiting,
  failed,
  formatAgo,
  formatNextRun,
}: {
  readonly vault: OverviewVault;
  readonly waiting: number;
  readonly failed: number;
  readonly formatAgo: (iso: string) => string;
  readonly formatNextRun: (iso: string) => string;
}) {
  const tasks = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: vault.environmentId, input: {} }),
  );
  const key = `${vault.environmentId}:${vault.projectId}`;
  const brain = brainBox({
    key,
    title: vault.title,
    link: notesLink({
      projectId: vault.projectId,
      environmentId: vault.environmentId,
      from: "overview",
    }),
    runner: vault.runner,
    routines: tasks.data?.tasks.filter((task) => task.projectId === vault.projectId) ?? null,
    waiting,
    failed,
    formatNextRun,
  });
  const backup = backupBox({ key, status: vault.backup, formatAgo });
  return (
    <div className="flex min-w-0 flex-col">
      <BoxCard box={brain} icon={BrainIcon} subtitle="Your brain" />
      <Connector label="copies to" vertical />
      <BoxCard box={backup} icon={CloudUploadIcon} />
    </div>
  );
}

/** A line between two boxes: across on wide screens, down on a phone (or always, when vertical). */
function Connector({
  label,
  vertical = false,
}: {
  readonly label: string;
  readonly vertical?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center gap-2 py-1 ps-6 text-2xs text-muted-foreground",
        !vertical && "md:mt-6 md:flex-col md:gap-1 md:px-1 md:py-0 md:ps-1",
      )}
    >
      <span className={cn("h-6 w-px bg-border", !vertical && "md:h-px md:w-14")} />
      <span className="whitespace-nowrap">{label}</span>
    </div>
  );
}

function BoxCard({
  box,
  icon: Icon,
  subtitle,
}: {
  readonly box: OverviewBox;
  readonly icon: LucideIcon;
  readonly subtitle?: string;
}) {
  return (
    <section
      aria-label={box.title}
      data-overview-box={box.key}
      data-tone={box.tone}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground",
        OVERVIEW_TONE_BOX_CLASS[box.tone],
      )}
    >
      <Link
        {...box.link}
        className="-m-1 flex min-w-0 items-center gap-2 rounded-md p-1 hover:bg-accent/40"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          {subtitle ? <span className="text-2xs text-muted-foreground">{subtitle}</span> : null}
          <span className="truncate text-sm font-medium">{box.title}</span>
        </span>
        <ToneDot tone={box.tone} className="self-center" />
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {box.lines.map((line) => {
          const content = (
            <>
              <ToneDot tone={line.tone} className="mt-1.5" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{line.text}</span>
                {line.detail ? (
                  <span className="text-xs text-muted-foreground">{line.detail}</span>
                ) : null}
              </span>
            </>
          );
          return (
            <li key={line.key} data-tone={line.tone} className="text-sm">
              {line.link ? (
                <Link
                  {...line.link}
                  className="-mx-1 flex items-start gap-2 rounded-md px-1 hover:bg-accent/40"
                >
                  {content}
                </Link>
              ) : (
                <div className="flex items-start gap-2">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const TONE_LABEL = {
  ok: "Fine",
  neutral: "",
  warning: "Needs your attention",
  error: "Something failed",
};

function ToneDot({
  tone,
  className,
}: {
  readonly tone: OverviewBox["tone"];
  readonly className: string;
}) {
  return (
    <span
      role={tone === "warning" || tone === "error" ? "img" : undefined}
      aria-label={TONE_LABEL[tone] || undefined}
      aria-hidden={tone === "neutral" ? true : undefined}
      className={cn("size-2 shrink-0 rounded-full", OVERVIEW_TONE_DOT_CLASS[tone], className)}
    />
  );
}
