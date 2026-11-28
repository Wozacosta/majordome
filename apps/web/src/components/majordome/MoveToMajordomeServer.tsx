import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthAccessWriteScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { hasAccountPublicConfig } from "../../cloud/publicConfig";
import { authEnvironment } from "../../state/auth";
import { useEnvironments } from "../../state/environments";
import { majordomeEnvironment } from "../../state/majordome";
import { readEnvironmentScope, readPreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { AddComputerButton } from "./AddComputerButton";
import { isHostedServer, machineInSentence } from "./brains.logic";
import { Muted, READING_MEASURE_CLASS, StatusLine } from "./paper";
import { useMachineNames } from "./useMachineNames";
import { useMajordomeVaults } from "./useMajordomeVaults";

/** Where an invite code becomes a server; it asks for the Majordome account the server is for. */
export const HOSTED_START_ADDRESS = "majord.me/start";
export const HOSTED_START_URL = `https://${HOSTED_START_ADDRESS}`;

/**
 * Sends this computer's notes to a server that exists already. The server has to be in this app:
 * the app asks it for a one-time code and hands that to this computer, so the owner types nothing.
 */
export function useMoveNotesToServer(environmentId: EnvironmentId) {
  const { machineOf } = useMachineNames();
  const { activeVault } = useMajordomeVaults();
  const projectId: ProjectId | null =
    activeVault?.copies.find((copy) => copy.environmentId === environmentId)?.projectId ?? null;
  const createPairingCredential = useAtomCommand(authEnvironment.createPairingCredential, {
    reportFailure: false,
  });
  const start = useAtomCommand(majordomeEnvironment.serverMoveStart, { reportFailure: false });
  const canStart = useAtomValue(majordomeEnvironment.serverMoveStart.permissionAtom(environmentId));
  const [busy, setBusy] = useState<EnvironmentId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const move = async (server: EnvironmentId) => {
    if (projectId === null) return;
    const name = machineInSentence(machineOf(server));
    const own = !isHostedServer(machineOf(server));
    const connection = readPreparedConnection(server);
    if (connection === null || !readEnvironmentScope(server, AuthAccessWriteScope)) {
      setError(
        `This app is not allowed to do this on ${name}. Remove it from this app in the list of your servers, add it again with a new code, then try again.`,
      );
      return;
    }
    setBusy(server);
    setError(null);
    const failure = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
      const cause = squashAtomCommandFailure(result);
      return cause instanceof Error ? cause.message : String(cause);
    };
    // Only the access the two need to exchange notes; it is spent when this computer pairs.
    const pairing = await createPairingCredential({
      environmentId: server,
      input: {
        label: `Majordome on ${machineOf(environmentId)}`,
        scopes: [AuthAccessWriteScope],
      },
    });
    if (pairing._tag === "Failure") {
      setBusy(null);
      if (!isAtomCommandInterrupted(pairing)) setError(failure(pairing));
      return;
    }
    const started = await start({
      environmentId,
      input: {
        projectId,
        location: "hosted",
        existing: {
          url: connection.httpBaseUrl,
          credential: pairing.value.credential,
          ...(own ? { own: true } : {}),
        },
      },
    });
    setBusy(null);
    if (started._tag === "Failure" && !isAtomCommandInterrupted(started)) {
      setError(failure(started));
    }
  };

  return {
    move,
    busy,
    error,
    canStart: canStart && projectId !== null,
    hasNotes: projectId !== null,
  };
}

/** The way to a server Majordome hosts: where to get one, then the button that moves the notes. */
export function MoveToMajordomeServer({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const { environments } = useEnvironments();
  const { move, busy, error, canStart, hasNotes } = useMoveNotesToServer(environmentId);
  const servers = environments.filter(
    (environment) =>
      environment.environmentId !== environmentId && isHostedServer(environment.label),
  );

  return (
    <div className="flex flex-col gap-3">
      <Muted className={READING_MEASURE_CLASS}>
        With an invite code, Majordome makes a server for you and looks after it: nothing to rent
        and nothing to install. Open{" "}
        <a
          href={HOSTED_START_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {HOSTED_START_ADDRESS}
        </a>
        , sign in and enter your code. About half a minute later the page opens your server, where
        you sign in to Claude, ChatGPT or Gemini with your own plan.
      </Muted>
      {servers.length === 0 ? (
        <Muted className={READING_MEASURE_CLASS}>
          Already have notes on this computer? On the server, skip “Start new notes”. Then{" "}
          {hasAccountPublicConfig() ? (
            <>
              open{" "}
              <Link to="/settings/account" className="underline underline-offset-2">
                Your account
              </Link>{" "}
              here, sign in with the same account and connect the server listed there
            </>
          ) : (
            <>add the server to this app with the button below</>
          )}
          . This page then offers to move your notes.
          {hasAccountPublicConfig() ? null : (
            <span className="mt-2 block">
              <AddComputerButton />
            </span>
          )}
        </Muted>
      ) : (
        <>
          <Muted className={READING_MEASURE_CLASS}>
            Your notes on this computer can move to it. Majordome copies them with their history,
            then keeps the two copies in step. Nothing on this computer is removed.
          </Muted>
          {servers.map((server) => (
            <div key={server.environmentId} className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                disabled={!canStart || busy !== null}
                onClick={() => void move(server.environmentId)}
              >
                {busy === server.environmentId ? <Spinner size="sm" /> : null}
                Move my notes to your Majordome server
              </Button>
              <span className="min-w-0 text-xs break-all text-muted-foreground">
                {readPreparedConnection(server.environmentId)?.httpBaseUrl ?? ""}
              </span>
            </div>
          ))}
          {hasNotes ? null : <Muted>Open a notes folder on this computer first.</Muted>}
        </>
      )}
      {error === null ? null : <StatusLine tone="error">{error}</StatusLine>}
    </div>
  );
}
