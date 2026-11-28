import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, MajordomeBackupStatus, ProviderInstanceId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { FolderIcon, GithubIcon, PlugIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";

import { useProjects } from "../../state/entities";
import { readLocalApi } from "../../localApi";
import {
  useEnvironmentHttpBaseUrl,
  useEnvironmentProviders,
  useEnvironments,
} from "../../state/environments";
import { majordomeEnvironment, vaultBackupStatusesAtom } from "../../state/majordome";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { GoogleDriveIcon } from "../Icons";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { Spinner } from "../ui/spinner";
import {
  aiRows,
  type AppRow,
  appsView,
  backupRows,
  CLAUDE_CONNECTORS_URL,
  claudeSignInTargets,
  type ConnectionState,
  connectionAction,
  connectorsView,
  isUnknownRequest,
  serverOrigin,
  withoutAppsConnectedHere,
} from "./connections.logic";
import { ComputerSwitch, useShownComputer } from "./ComputerSwitch";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import {
  Entry,
  EntryList,
  EntryTitle,
  Muted,
  Section,
  StatusLine,
  Step,
  Steps,
  SwitchLabel,
  ToneDot,
} from "./paper";
import { SERVICE_BRAND_ICONS } from "./ServicesUsed";
import { serviceBrand } from "./servicesUsed.logic";
import { useMachineNames } from "./useMachineNames";

/** What the assistant can reach on each computer: its AI accounts, connectors and backups. */
export function ConnectionsPage() {
  const { environments } = useEnvironments();
  const { primaryEnvironmentId, machineOf, isElsewhere } = useMachineNames();
  const machines = [
    ...environments.filter((environment) => environment.environmentId === primaryEnvironmentId),
    ...environments.filter((environment) => environment.environmentId !== primaryEnvironmentId),
  ];
  const connected = machines.filter((machine) => machine.connection.phase === "connected");

  const projects = useProjects().filter((project) => !project.isScratch && !project.archivedAt);
  const backupResults = useAtomValue(
    vaultBackupStatusesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );
  /** The machine's notes folders' backups; null while any of them is still loading. */
  const backupsOf = (environmentId: EnvironmentId) => {
    const statuses: Array<MajordomeBackupStatus> = [];
    for (const [index, project] of projects.entries()) {
      if (project.environmentId !== environmentId) continue;
      const result = backupResults[index];
      if (result === undefined || result._tag === "Initial") return null;
      const status = AsyncResult.getOrElse(result, () => null);
      if (status?.isVault) statuses.push(status);
    }
    return statuses;
  };

  const checkConnectors = useAtomCommand(majordomeEnvironment.checkConnectors, {
    label: "check connectors",
    // A machine that cannot answer says so in its own list.
    reportFailure: false,
    reportDefect: false,
  });
  const [checking, setChecking] = useState(false);
  const checkAgain = async () => {
    setChecking(true);
    await Promise.all(
      connected.map(({ environmentId }) =>
        checkConnectors({ environmentId, input: { refresh: true } }),
      ),
    );
    setChecking(false);
  };

  const choices = machines.map((machine) => ({
    id: machine.environmentId,
    label: machineOf(machine.environmentId),
    machine,
  }));
  const [shown, showComputer] = useShownComputer(choices);

  return (
    <MajordomeSettingsPage
      outline={false}
      searchId="majordome-connections"
      intro="What your assistant can reach. Each computer has its own sign-ins, so a routine can only use what is connected on the computer it runs on."
      action={
        <Button
          size="xs"
          variant="outline"
          disabled={checking || connected.length === 0}
          onClick={() => void checkAgain()}
        >
          {checking ? <Spinner size="sm" /> : null}
          Check again
        </Button>
      }
    >
      {machines.length === 0 ? (
        <Section>
          <Skeleton className="h-40 w-full" />
        </Section>
      ) : null}
      <ComputerSwitch choices={choices} shownId={shown?.id ?? null} onShow={showComputer} />
      {shown === null ? null : (
        <div data-connections-machine={shown.id}>
          {shown.machine.connection.phase === "connected" ? (
            <Machine
              environmentId={shown.id}
              name={machines.length > 1 ? shown.label : null}
              backups={backupsOf(shown.id)}
              elsewhere={isElsewhere(shown.id)}
            />
          ) : (
            <Section>
              <Muted>Majordome isn't connected to this computer right now.</Muted>
            </Section>
          )}
        </div>
      )}
    </MajordomeSettingsPage>
  );
}

function Machine({
  environmentId,
  name,
  backups,
  elsewhere,
}: {
  readonly environmentId: EnvironmentId;
  /** The machine's name, where several are shown. */
  readonly name: string | null;
  readonly backups: ReadonlyArray<MajordomeBackupStatus> | null;
  readonly elsewhere: boolean;
}) {
  const providers = useEnvironmentProviders().get(environmentId) ?? null;
  const ai = providers === null ? null : aiRows(providers);
  // Under a machine's name the labels are one level down; a lone machine has no name above them.
  const labelAs = "h2";
  const sectionClassName = undefined;
  return (
    <>
      <Section
        label="AI"
        labelAs={labelAs}
        className={sectionClassName}
        // Each card opens its own account; with none, this is the way to the page that adds one.
        action={
          ai?.length === 0 ? (
            <Link to="/settings/providers" className="underline underline-offset-2">
              AI accounts
            </Link>
          ) : undefined
        }
      >
        {ai === null ? (
          <Skeleton className="h-10 w-full" />
        ) : ai.length === 0 ? (
          <Muted>No AI account is turned on here.</Muted>
        ) : (
          <ServiceGrid
            services={ai.map((row) => ({
              ...row,
              mark: (
                <ProviderInstanceIcon
                  driverKind={row.driver}
                  displayName={row.name}
                  accentColor={row.accentColor}
                  showBadge={false}
                  iconClassName={MARK_CLASS}
                />
              ),
              place: (
                <Link to="/settings/providers" search={{ environmentId, instanceId: row.key }} />
              ),
            }))}
          />
        )}
      </Section>
      <Section label="Apps" labelAs={labelAs}>
        <Connectors environmentId={environmentId} name={name} />
      </Section>
      <AppCatalog environmentId={environmentId} labelAs={labelAs} />
      <Section
        label="Backups"
        labelAs={labelAs}
        action={
          backups?.length === 0 ? (
            <Link to="/settings/backup" className="underline underline-offset-2">
              Back up my brain
            </Link>
          ) : undefined
        }
      >
        {backups === null ? (
          <Skeleton className="h-10 w-full" />
        ) : backups.length === 0 ? (
          <Muted>No notes folder on this computer.</Muted>
        ) : (
          <ServiceGrid
            services={backupRows(backups, { elsewhere }).map((row) => ({
              ...row,
              mark: BACKUP_MARKS[row.key],
              place: <Link to="/settings/backup" />,
            }))}
          />
        )}
      </Section>
    </>
  );
}

function Connectors({
  environmentId,
  name,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: string | null;
}) {
  const result = useAtomValue(majordomeEnvironment.connectors({ environmentId, input: {} }));
  // A server from before apps could be connected here fails this; it then lists none.
  const appsResult = useAtomValue(majordomeEnvironment.connections({ environmentId, input: {} }));
  const snapshots = useEnvironmentProviders().get(environmentId) ?? null;
  const connectors = AsyncResult.getOrElse(result, () => null);
  if (connectors === null) {
    if (result._tag !== "Failure") return <Skeleton className="h-16 w-full" />;
    return isUnknownRequest(Cause.squash(result.cause)) ? (
      <Muted>Update Majordome on this computer to see what it can reach.</Muted>
    ) : (
      <p className="text-sm text-destructive-foreground">
        {formatEnvironmentQueryError(result.cause)}
      </p>
    );
  }
  const apps = appsView(AsyncResult.getOrElse(appsResult, () => ({ apps: [], connections: [] })));
  const fromAccounts = connectorsView({ result: connectors, snapshots, machine: name });
  const view = {
    ...fromAccounts,
    rows: withoutAppsConnectedHere(fromAccounts.rows, apps.connected),
  };
  const targets = claudeSignInTargets({ result: connectors, snapshots });
  const signIns = targets.filter((target) => target.reason === "signed-out");
  const unconnected = targets.filter((target) => target.reason === "no-connectors");
  return (
    <>
      <ConnectedApps environmentId={environmentId} apps={apps}>
        {view.rows.length > 0 ? (
          <ServiceGrid
            className={apps.connected.length > 0 ? "mt-2" : undefined}
            services={view.rows.map((row) => ({
              ...row,
              mark: connectorMark(row.name),
              place:
                row.manageUrl === null ? null : (
                  <a href={row.manageUrl} target="_blank" rel="noreferrer" />
                ),
            }))}
          />
        ) : null}
      </ConnectedApps>
      {view.rows.some((row) => row.signInUrl !== null) ? (
        <Muted className="mt-2">After you sign in, come back here and press “Check again”.</Muted>
      ) : null}
      {view.warnings.length + view.notes.length + signIns.length > 0 ? (
        <EntryList>
          {view.warnings.map((warning) => (
            <Entry key={warning}>
              <StatusLine tone="warning">{warning}</StatusLine>
            </Entry>
          ))}
          {view.notes.map((note) => (
            <Entry key={note}>
              <Muted>{note}</Muted>
            </Entry>
          ))}
          {signIns.map((target) => (
            <Entry key={target.instanceId}>
              <Muted>
                <Link
                  to="/settings/providers"
                  search={{ environmentId, instanceId: target.instanceId }}
                  className="text-foreground underline underline-offset-2"
                >
                  {targets.length > 1 ? `Sign in to ${target.name}` : "Sign in to Claude"}
                </Link>{" "}
                with your own account so the assistant can reach Gmail, Calendar and Drive.
              </Muted>
            </Entry>
          ))}
        </EntryList>
      ) : null}
      {unconnected.map((target) => (
        <HowToConnect
          key={target.instanceId}
          environmentId={environmentId}
          instanceId={target.instanceId}
          account={targets.length > 1 ? target.name : null}
        />
      ))}
    </>
  );
}

/** Opens a page in the person's own browser; the desktop app has none of its own. */
function openInBrowser(url: string) {
  const shell = readLocalApi()?.shell;
  if (shell === undefined) window.open(url, "_blank", "noopener");
  else void shell.openExternal(url).catch(() => undefined);
}

/** Starting a sign-in to an app: the one button a catalogue card and a lapsed connection share. */
function useConnectApp(environmentId: EnvironmentId) {
  const allowed = useAtomValue(majordomeEnvironment.startConnection.permissionAtom(environmentId));
  const origin = serverOrigin(useEnvironmentHttpBaseUrl(environmentId));
  const start = useAtomCommand(majordomeEnvironment.startConnection, { reportFailure: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const connect = async (appId: string) => {
    if (origin === null) return;
    setBusy(appId);
    setProblem(null);
    const result = await start({ environmentId, input: { appId, origin } });
    setBusy(null);
    if (result._tag === "Failure") setProblem(formatEnvironmentQueryError(result.cause));
    else openInBrowser(result.value.authorizationUrl);
  };
  return { allowed, canStart: origin !== null, busy, setBusy, problem, connect };
}

/** The apps that can be connected on this computer and are not yet. Nothing when there is none. */
function AppCatalog({
  environmentId,
  labelAs,
}: {
  readonly environmentId: EnvironmentId;
  readonly labelAs: "h2";
}) {
  const result = useAtomValue(majordomeEnvironment.connections({ environmentId, input: {} }));
  const { addable } = appsView(
    AsyncResult.getOrElse(result, () => ({ apps: [], connections: [] })),
  );
  const { allowed, canStart, busy, problem, connect } = useConnectApp(environmentId);
  if (!allowed || addable.length === 0) return null;
  return (
    <Section label="App catalog" labelAs={labelAs}>
      <ServiceGrid
        services={addable.map((app) => ({
          key: `add:${app.id}`,
          name: app.name,
          mark: appMark(app.name),
          state: { label: app.about, tone: "neutral" as const },
          plain: true,
          place: null,
          action: (
            <Button
              size="xs"
              variant="outline"
              disabled={busy === app.id || !canStart}
              onClick={() => void connect(app.id)}
            >
              {busy === app.id ? <Spinner size="sm" /> : null}
              Connect
            </Button>
          ),
        }))}
      />
      {problem === null ? null : (
        <p className="mt-2 text-sm text-destructive-foreground">{problem}</p>
      )}
    </Section>
  );
}

/** The apps connected through Majordome on this computer. */
function ConnectedApps({
  environmentId,
  apps,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly apps: ReturnType<typeof appsView>;
  /** What the AI accounts bring, listed after the apps connected here. */
  readonly children: ReactNode;
}) {
  const { allowed, busy, setBusy, problem, connect } = useConnectApp(environmentId);
  const remove = useAtomCommand(majordomeEnvironment.removeConnection, {
    label: "disconnect the app",
  });
  const setRoutines = useAtomCommand(majordomeEnvironment.setConnectionRoutines, {
    label: "change what routines may do",
  });
  const check = useAtomCommand(majordomeEnvironment.checkConnections, {
    reportFailure: false,
    reportDefect: false,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a sign-in ends in a browser tab, outside the app; coming back to the window is the only sign it may be done
  useEffect(() => {
    const onFocus = () => void check({ environmentId, input: {} });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check, environmentId]);

  const disconnect = async (appId: string) => {
    setBusy(appId);
    await remove({ environmentId, input: { appId } });
    setBusy(null);
  };

  const actionFor = (row: AppRow) =>
    !allowed ? null : (
      <>
        {row.state.needsSignIn ? (
          <Button size="xs" disabled={busy === row.appId} onClick={() => void connect(row.appId)}>
            Sign in
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="outline"
          disabled={busy === row.appId}
          onClick={() => void disconnect(row.appId)}
        >
          {busy === row.appId ? <Spinner size="sm" /> : null}
          Disconnect
        </Button>
      </>
    );

  return (
    <>
      {apps.connected.length > 0 ? (
        <ServiceGrid
          services={apps.connected.map((row) => ({
            key: `app:${row.appId}`,
            name: row.name,
            mark: appMark(row.name),
            state: row.state,
            place: null,
            action: actionFor(row),
            extra: allowed ? (
              <SwitchLabel className="min-h-0 text-xs text-muted-foreground">
                <Switch
                  checked={row.routinesMayChange}
                  onCheckedChange={(checked) =>
                    void setRoutines({
                      environmentId,
                      input: { appId: row.appId, routinesMayChange: checked },
                    })
                  }
                />
                Let routines make changes in {row.name}
              </SwitchLabel>
            ) : null,
          }))}
        />
      ) : null}
      {children}
      {problem === null ? null : (
        <p className="mt-2 text-sm text-destructive-foreground">{problem}</p>
      )}
    </>
  );
}

/** For a Claude account that is signed in and brings no connector: where they are added. */
function HowToConnect({
  environmentId,
  instanceId,
  account,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  /** The account's name, where several are shown. */
  readonly account: string | null;
}) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">
        How to connect Gmail, Calendar or Drive{account === null ? "" : ` to ${account}`}
      </p>
      <Muted>
        They are connected once, in your Claude account on the web. Majordome then finds them by
        itself on every computer signed in to that account.
      </Muted>
      <Steps>
        <Step title="Open your Claude account's connectors">
          <div>
            <Button
              size="xs"
              variant="outline"
              render={<a href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noreferrer" />}
            >
              Open Claude's connectors
            </Button>
          </div>
          <p>Or, in Claude on the web, open Customize, then Connectors.</p>
        </Step>
        <Step title="Connect what you want the assistant to reach">
          <p>Choose Gmail, Google Calendar or Google Drive, and sign in to each with Google.</p>
        </Step>
        <Step title="Come back here and press “Check again”">
          <p>It is at the top of this page. What you connected shows in this list.</p>
        </Step>
      </Steps>
      <Muted>
        Already connected there and still nothing here? This computer may be signed in to Claude in
        a way that leaves connectors out.{" "}
        <Link
          to="/settings/providers"
          search={{ environmentId, instanceId }}
          className="text-foreground underline underline-offset-2"
        >
          Sign in to Claude again
        </Link>
        , then press “Check again”.
      </Muted>
    </div>
  );
}

interface Service {
  readonly key: string;
  readonly name: string;
  readonly mark: ReactNode;
  /** The account a connector comes with, where several accounts are listed together. */
  readonly provider?: string | null;
  readonly state: ConnectionState;
  /** The link its button is: where it is signed in to or managed. Null when there is no such place. */
  readonly place: ReactElement | null;
  /** The line under the name says what the service is, not how it is doing: no dot. */
  readonly plain?: true;
  /** A button of its own, in place of the link. */
  readonly action?: ReactNode;
  /** A setting of its own, under the row. */
  readonly extra?: ReactNode;
}

function ServiceGrid({
  services,
  className,
}: {
  readonly services: ReadonlyArray<Service>;
  readonly className?: string | undefined;
}) {
  return (
    <EntryList
      className={cn(
        "grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2",
        className,
      )}
    >
      {services.map((service) => (
        <li
          key={service.key}
          data-connection={service.name}
          className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60"
            >
              {service.mark}
            </span>
            <div className="min-w-0 flex-1">
              <EntryTitle className="truncate">{service.name}</EntryTitle>
              <p
                className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                data-tone={service.state.tone}
              >
                {service.plain ? null : <ToneDot tone={service.state.tone} />}
                <span className="min-w-0 truncate">
                  {[service.state.label, service.provider].filter(Boolean).join(" · ")}
                </span>
              </p>
            </div>
            {service.action}
            {service.place === null ? null : (
              <Button
                size="xs"
                variant={service.state.needsSignIn ? "default" : "outline"}
                render={service.place}
              >
                {connectionAction(service.state)}
              </Button>
            )}
          </div>
          {service.state.detail === undefined ? null : (
            <p className="text-xs text-muted-foreground">{service.state.detail}</p>
          )}
          {service.extra}
        </li>
      ))}
    </EntryList>
  );
}

const MARK_CLASS = "size-5 shrink-0";

const BACKUP_MARKS: Readonly<Record<string, ReactNode>> = {
  github: <GithubIcon className={MARK_CLASS} />,
  "google-drive": <GoogleDriveIcon className={MARK_CLASS} />,
  folder: <FolderIcon className={cn(MARK_CLASS, "text-muted-foreground")} />,
};

/** An app from the catalogue: its brand's mark where there is one, else its initial. */
function appMark(name: string): ReactNode {
  return serviceBrand(name) === null ? (
    <span className="text-sm font-semibold text-muted-foreground">{name.slice(0, 1)}</span>
  ) : (
    connectorMark(name)
  );
}

function connectorMark(name: string): ReactNode {
  const brand = serviceBrand(name);
  if (brand === null) return <PlugIcon className={cn(MARK_CLASS, "text-muted-foreground")} />;
  const Brand = SERVICE_BRAND_ICONS[brand];
  return <Brand className={MARK_CLASS} />;
}
