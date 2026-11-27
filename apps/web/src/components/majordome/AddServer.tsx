import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { CommandBlock } from "../CommandBlock";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { AddComputerButton } from "./AddComputerButton";
import { AlwaysOnManualGuide } from "./AlwaysOnManualGuide";
import { machineInSentence } from "./brains.logic";
import { useMoveNotesToServer } from "./MoveToMajordomeServer";
import {
  Disclosure,
  EntryList,
  EntryTitle,
  ROW_ACTION_CLASS,
  Section,
  StatusLine,
  Step,
  Steps,
} from "./paper";
import type { ServerRow } from "./servers.logic";
import { ownServerCommand, ownServerTargets, type ServerWayRow } from "./serverWays.logic";

const TAILSCALE_KEYS_URL = "https://login.tailscale.com/admin/settings/keys";
const TAILSCALE_DNS_URL = "https://login.tailscale.com/admin/dns";

/** The ways to get a server, one line each; each opens its own page. */
export function AddServerChoices({
  rows,
  another,
}: {
  readonly rows: ReadonlyArray<ServerWayRow>;
  /** The notes are on a server already, so this one would be one more. */
  readonly another: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <Section label={another ? "Add another server" : "Add a server"}>
      <EntryList>
        {rows.map((row) => (
          <li key={row.way} className="border-t border-border">
            <Link
              to="/settings/always-on"
              search={{ add: row.way }}
              className={cn(ROW_ACTION_CLASS, "flex items-center gap-3 py-3")}
            >
              <span className="min-w-0 flex-1">
                <EntryTitle>{row.title}</EntryTitle>
                <span className="block text-xs text-muted-foreground">{row.line}</span>
              </span>
              <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </EntryList>
    </Section>
  );
}

function ExternalLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  );
}

/**
 * A server the owner has already: one command installs Majordome on it, it is added to this app,
 * and this computer's notes move to it. `environmentId` is null in a window with no computer of
 * its own, which has no notes to move.
 */
export function OwnServerGuide({
  environmentId,
  servers,
  notesElsewhere,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly servers: ReadonlyArray<ServerRow>;
  /** This computer's notes are on a server already, and go to one server at a time. */
  readonly notesElsewhere: boolean;
}) {
  const targets = ownServerTargets(servers);
  return (
    <>
      <Section>
        <Steps>
          <Step title="Make a Tailscale key">
            <ExternalLink href="https://tailscale.com">Tailscale</ExternalLink> is a free service
            that keeps the server private: only your own devices can reach it. Make a key on{" "}
            <ExternalLink href={TAILSCALE_KEYS_URL}>Tailscale's keys page</ExternalLink>, with the
            account this computer is on, and turn on HTTPS Certificates on its{" "}
            <ExternalLink href={TAILSCALE_DNS_URL}>DNS page</ExternalLink>.
          </Step>
          <Step title="Run this on the server">
            <CommandBlock
              command={ownServerCommand(new Intl.DateTimeFormat().resolvedOptions().timeZone)}
            />
            It asks for the key and ends with a link.
          </Step>
          <Step title="Add it to this app">
            {targets.length === 0 ? (
              "Paste the link the server gave you."
            ) : (
              <StatusLine tone="ok">
                {targets.map((server) => server.name).join(", ")}{" "}
                {targets.length === 1 ? "is" : "are"} in this app.
              </StatusLine>
            )}
            <span className="block">
              <AddComputerButton />
            </span>
          </Step>
          <Step title="Move your notes to it">
            {environmentId === null ? (
              "Open this page on the computer that has your notes."
            ) : notesElsewhere ? (
              "Your notes are on another server. Bring them back first, on the page before this one."
            ) : (
              <MoveNotes environmentId={environmentId} targets={targets} />
            )}
          </Step>
        </Steps>
      </Section>
      <Section>
        <Disclosure summary="Do each step by hand instead">
          <AlwaysOnManualGuide />
        </Disclosure>
      </Section>
    </>
  );
}

function MoveNotes({
  environmentId,
  targets,
}: {
  readonly environmentId: EnvironmentId;
  readonly targets: ReadonlyArray<ServerRow>;
}) {
  const { move, busy, error, canStart, hasNotes } = useMoveNotesToServer(environmentId);
  return (
    <>
      Majordome copies them with their history, then keeps the two copies in step. Nothing on this
      computer is removed.
      {targets.map((server) =>
        server.hasNotes === true ? (
          <StatusLine key={server.environmentId} tone="ok">
            {server.name} has a copy of your notes.
          </StatusLine>
        ) : (
          <span key={server.environmentId} className="block">
            <Button
              size="sm"
              disabled={!canStart || busy !== null}
              onClick={() => void move(server.environmentId)}
            >
              {busy === server.environmentId ? <Spinner size="sm" /> : null}
              Move my notes to {machineInSentence(server.name)}
            </Button>
          </span>
        ),
      )}
      {hasNotes ? null : <span className="block">Open a notes folder on this computer first.</span>}
      {error === null ? null : <StatusLine tone="error">{error}</StatusLine>}
    </>
  );
}
