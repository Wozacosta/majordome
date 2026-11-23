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
import { isHostedServer } from "./brains.logic";
import { Muted, READING_MEASURE_CLASS, StatusLine } from "./paper";
import { useMachineNames } from "./useMachineNames";
import { useMajordomeVaults } from "./useMajordomeVaults";

/** Where an invite code becomes a server; it asks for the Majordome account the server is for. */
export const HOSTED_START_ADDRESS = "majord.me/start";
export const HOSTED_START_URL = `https://${HOSTED_START_ADDRESS}`;

/**
 * Sends this computer's notes to a server Majordome hosts for the owner. The server has to be in
 * this app already: the app asks it for a one-time code and hands that to this computer, so the
 * owner types nothing.
 */
export function MoveToMajordomeServer({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const { environments } = useEnvironments();
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
  const servers = environments.filter(
    (environment) =>
      environment.environmentId !== environmentId && isHostedServer(environment.label),
  );

  const move = async (server: EnvironmentId) => {
    if (projectId === null) return;
    const connection = readPreparedConnection(server);
    if (connection === null || !readEnvironmentScope(server, AuthAccessWriteScope)) {
      setError(
        "This app is not allowed to do this on your Majordome server. Add the server again in Computers with a new code, then try again.",
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
        existing: { url: connection.httpBaseUrl, credential: pairing.value.credential },
      },
    });
    setBusy(null);
    if (started._tag === "Failure" && !isAtomCommandInterrupted(started)) {
      setError(failure(started));
    }
  };

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
        you sign in to Claude with your own plan.
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
            <>
              add the server to this app in{" "}
              <Link to="/settings/connections" className="underline underline-offset-2">
                Computers
              </Link>
            </>
          )}
          . Come back to this page and it offers to move your notes.
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
                disabled={!canStart || projectId === null || busy !== null}
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
          {projectId === null ? <Muted>Open a notes folder on this computer first.</Muted> : null}
        </>
      )}
      {error === null ? null : <StatusLine tone="error">{error}</StatusLine>}
    </div>
  );
}
