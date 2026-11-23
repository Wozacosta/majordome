import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, MajordomeBackupStatus, ProviderInstanceId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { useProjects } from "../../state/entities";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { majordomeEnvironment, vaultBackupStatusesAtom } from "../../state/majordome";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import {
  aiRows,
  backupRows,
  CLAUDE_CONNECTORS_URL,
  claudeSignInTargets,
  type ConnectionState,
  connectorsView,
  isUnknownRequest,
} from "./connections.logic";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import { Entry, EntryList, Muted, Section, SectionTitle, StatusLine, Step, Steps } from "./paper";
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

  return (
    <MajordomeSettingsPage
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
      {machines.map((machine) => {
        const name = machines.length > 1 ? machineOf(machine.environmentId) : null;
        return (
          <div
            key={machine.environmentId}
            className={name === null ? undefined : "mt-10"}
            data-connections-machine={machine.environmentId}
          >
            {name !== null ? <SectionTitle>{name}</SectionTitle> : null}
            {machine.connection.phase === "connected" ? (
              <Machine
                environmentId={machine.environmentId}
                name={name}
                backups={backupsOf(machine.environmentId)}
                elsewhere={isElsewhere(machine.environmentId)}
              />
            ) : (
              <Muted className="mt-2">Majordome isn't connected to this computer right now.</Muted>
            )}
          </div>
        );
      })}
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
  const labelAs = name === null ? "h2" : "h3";
  const sectionClassName = name === null ? undefined : "mt-5";
  return (
    <>
      <Section
        label="AI"
        labelAs={labelAs}
        className={sectionClassName}
        action={
          <Link to="/settings/providers" className="underline underline-offset-2">
            AI accounts
          </Link>
        }
      >
        {ai === null ? (
          <Skeleton className="h-10 w-full" />
        ) : ai.length === 0 ? (
          <Muted>No AI account is turned on here.</Muted>
        ) : (
          <Rows
            rows={ai}
            signIn={(row) => ({
              to: "/settings/providers",
              search: { environmentId, instanceId: row.key },
            })}
          />
        )}
      </Section>
      <Section label="Email, calendar and files" labelAs={labelAs}>
        <Connectors environmentId={environmentId} name={name} />
      </Section>
      <Section
        label="Backups"
        labelAs={labelAs}
        action={
          <Link to="/settings/backup" className="underline underline-offset-2">
            Back up my brain
          </Link>
        }
      >
        {backups === null ? (
          <Skeleton className="h-10 w-full" />
        ) : backups.length === 0 ? (
          <Muted>No notes folder on this computer.</Muted>
        ) : (
          <Rows
            rows={backupRows(backups, { elsewhere })}
            signIn={() => ({ to: "/settings/backup" })}
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
  const view = connectorsView({ result: connectors, snapshots, machine: name });
  const targets = claudeSignInTargets({ result: connectors, snapshots });
  const signIns = targets.filter((target) => target.reason === "signed-out");
  const unconnected = targets.filter((target) => target.reason === "no-connectors");
  return (
    <>
      {view.rows.length > 0 ? <Rows rows={view.rows} /> : null}
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

interface Row {
  readonly key: string;
  readonly name: string;
  readonly provider?: string | null;
  readonly state: ConnectionState;
  readonly signInUrl?: string | null;
}

type SignInTarget =
  | { readonly to: "/settings/backup" }
  | {
      readonly to: "/settings/providers";
      readonly search: {
        readonly environmentId: EnvironmentId;
        readonly instanceId: ProviderInstanceId;
      };
    };

function Rows<R extends Row>({
  rows,
  signIn,
}: {
  readonly rows: ReadonlyArray<R>;
  /** Where a row that needs a sign-in gets one. */
  readonly signIn?: (row: R) => SignInTarget;
}) {
  return (
    <EntryList>
      {rows.map((row) => (
        <Entry
          key={row.key}
          title={row.name}
          meta={[row.provider, row.state.detail].filter(Boolean).join(" · ") || undefined}
          actions={
            <>
              {signIn !== undefined && row.state.needsSignIn ? (
                <Link {...signIn(row)} className="text-sm underline underline-offset-2">
                  Sign in
                </Link>
              ) : null}
              {row.signInUrl == null ? null : (
                <a
                  href={row.signInUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline underline-offset-2"
                >
                  Sign in on claude.ai
                </a>
              )}
              <Badge
                variant={
                  row.state.tone === "ok"
                    ? "success"
                    : row.state.tone === "warning"
                      ? "warning"
                      : "outline"
                }
              >
                {row.state.label}
              </Badge>
            </>
          }
        />
      ))}
    </EntryList>
  );
}
