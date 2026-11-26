import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { environmentCatalog } from "../../connection/catalog";
import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import { useProjects } from "../../state/entities";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { vaultHistoriesAtom } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { AddEnvironmentDialog } from "../settings/AddEnvironmentDialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { machineInSentence } from "./brains.logic";
import { MakeMainButton, MakeMainDialog } from "./MakeMainDialog";
import { RoutinesClashNotice } from "./RoutinesClashNotice";
import { Entry, EntryList, Muted, READING_MEASURE_CLASS, Section, StatusLine } from "./paper";
import { hasReadyProvider } from "./serverMove.logic";
import { type MainMove, mainMove, serverLines, type ServerRow, serverRows } from "./servers.logic";
import { ServersMap } from "./ServersMap";
import { useBrainRunners } from "./useBrainRunners";
import { useMachineNames } from "./useMachineNames";
import { useAssistantEnvironmentId } from "./useMajordomeVaults";

/** Every computer other than this one that the app is connected to, see `serverRows`. */
export function useServers(): ReadonlyArray<ServerRow> {
  const { primaryEnvironmentId, localEnvironmentId, machineOf } = useMachineNames();
  const { environments } = useEnvironments();
  const providers = useEnvironmentProviders();
  const servers = environments.filter(
    (environment) =>
      environment.environmentId !== localEnvironmentId &&
      !isDesktopLocalConnectionTarget(environment.entry.target),
  );
  const connected = servers
    .filter((environment) => environment.connection.phase === "connected")
    .map((environment) => environment.environmentId);
  const projects = useProjects().filter(
    (project) =>
      !project.isScratch && !project.archivedAt && connected.includes(project.environmentId),
  );
  const histories = useAtomValue(
    vaultHistoriesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );
  return serverRows({
    servers: servers.map((environment) => ({
      environmentId: environment.environmentId,
      name: machineOf(environment.environmentId),
      address: environment.displayUrl,
      phase: environment.connection.phase,
      isThisWindow: environment.environmentId === primaryEnvironmentId,
      signedIn: hasReadyProvider(providers.get(environment.environmentId)),
    })),
    copies: projects.map((project, index) => {
      const result = histories[index];
      // A server that cannot say holds no notes Majordome can show.
      if (result !== undefined && result._tag === "Failure") {
        return { environmentId: project.environmentId, routinesRunner: null, isVault: false };
      }
      const history = result === undefined ? null : AsyncResult.getOrElse(result, () => null);
      return {
        environmentId: project.environmentId,
        routinesRunner: history?.isVault === true ? history.routinesRunner : null,
        isVault: history?.isVault,
      };
    }),
  });
}

function addressHost(address: string | null): string | null {
  if (address === null) return null;
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

/**
 * The servers this app is connected to, and a way to add one that already exists. `managedId` is
 * the server this page set up or moved the notes to: the rest of the page removes that one.
 */
export function YourServers({
  servers,
  managedId,
}: {
  readonly servers: ReadonlyArray<ServerRow>;
  readonly managedId: EnvironmentId | null;
}) {
  const { environments } = useEnvironments();
  const mainId = useAssistantEnvironmentId();
  const remove = useAtomCommand(environmentCatalog.remove, { reportFailure: false });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ServerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const { brains, activeKey } = useBrainRunners();
  const activeBrain = brains.find((brain) => brain.key === activeKey);
  const [makingMain, setMakingMain] = useState<MainMove | null>(null);

  const doRemove = async () => {
    if (removing === null) return;
    setBusy(true);
    setRemoveError(null);
    const result = await remove(removing.environmentId);
    setBusy(false);
    if (result._tag === "Success") setRemoving(null);
    else setRemoveError("It could not be removed. Try again.");
  };

  return (
    <Section
      label="Your servers"
      action={
        <AddEnvironmentDialog
          open={adding}
          routeTarget={null}
          error={addError}
          savedEnvironments={environments.filter(
            (environment) => environment.entry.target._tag !== "PrimaryConnectionTarget",
          )}
          onOpenChange={(open) => {
            setAdding(open);
            if (!open) setAddError(null);
          }}
          onErrorChange={setAddError}
        />
      }
    >
      {servers.length === 0 ? (
        <Muted className={READING_MEASURE_CLASS}>None yet.</Muted>
      ) : (
        <>
          <RoutinesClashNotice />
          <ServersMap servers={servers} />
          <EntryList>
            {servers.map((server) => {
              const move = mainMove(server, activeBrain, mainId);
              return (
                <Entry
                  key={server.environmentId}
                  title={server.name}
                  aside={server.environmentId === mainId ? <Badge size="sm">Main</Badge> : null}
                  meta={[
                    // Where Majordome keeps a server it hosts is its own business, never shown.
                    server.hosted ? "Majordome looks after it" : addressHost(server.address),
                    server.isThisWindow ? "You are on it now" : null,
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                  actions={
                    <>
                      {move === null ? null : (
                        <MakeMainButton move={move} onClick={() => setMakingMain(move)} />
                      )}
                      {server.isThisWindow || server.environmentId === managedId ? null : (
                        <Button
                          size="xs"
                          variant="ghost-muted"
                          aria-label={`Remove ${server.name} from this app`}
                          onClick={() => {
                            setRemoveError(null);
                            setRemoving(server);
                          }}
                        >
                          Remove from this app
                        </Button>
                      )}
                    </>
                  }
                >
                  {serverLines(server).map((line) => (
                    <StatusLine key={line.text} tone={line.tone}>
                      {line.text}
                      {line.signIn ? (
                        <>
                          {" "}
                          <Link
                            to="/settings/providers"
                            search={{ environmentId: server.environmentId }}
                            className="underline underline-offset-2"
                          >
                            Sign in on it
                          </Link>
                        </>
                      ) : null}
                    </StatusLine>
                  ))}
                </Entry>
              );
            })}
          </EntryList>
        </>
      )}
      <MakeMainDialog move={makingMain} onClose={() => setMakingMain(null)} />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removing === null ? "it" : machineInSentence(removing.name)} from this app?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its chats leave this app. The server keeps running.
            </AlertDialogDescription>
            {removeError === null ? null : <StatusLine tone="error">{removeError}</StatusLine>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
              Keep it
            </AlertDialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => void doRemove()}>
              {busy ? <Spinner size="sm" /> : null}
              Remove from this app
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Section>
  );
}
