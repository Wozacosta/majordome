import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  MajordomeServerMove,
  MajordomeServerMoveCheck,
  MajordomeServerMoveRemoval,
  MajordomeServerMoveStatus,
  ProjectId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { useMessages } from "gt-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { environmentCatalog } from "../../connection/catalog";
import { connectPairing } from "../../connection/onboarding";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { majordomeEnvironment } from "../../state/majordome";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { AlwaysOnManualGuide } from "./AlwaysOnManualGuide";
import { isHostedServer } from "./brains.logic";
import { useMachineNames } from "./useMachineNames";
import { SETTINGS_SECTION_LABELS } from "../settings/settingsSearch";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import {
  Disclosure,
  Entry,
  EntryList,
  Muted,
  READING_MEASURE_CLASS,
  Section,
  StatusLine,
  Step,
  Steps,
  ToneDot,
} from "./paper";
import {
  chosenLocation,
  hasReadyProvider,
  locationLabel,
  openServerKey,
  problemsFor,
  type ServerKey,
  type ServerMoveView,
  serverMoveNextStep,
  serverMoveStepRows,
  serverMoveView,
  serverSetupAction,
  serverSummary,
} from "./serverMove.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";

const HETZNER_CONSOLE_URL = "https://console.hetzner.com/";
const TAILSCALE_TAGS_URL = "https://login.tailscale.com/admin/acls";
const TAILSCALE_CREDENTIALS_URL = "https://login.tailscale.com/admin/settings/trust-credentials";

/** The sentence to show for a failed command, and whether the server offered to go on anyway. */
function failureOf(result: AtomCommandResult<unknown, unknown>): {
  readonly message: string;
  readonly canForce: boolean;
} | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return {
    message: error instanceof Error ? error.message : String(error),
    canForce:
      typeof error === "object" && error !== null && "canForce" in error && error.canForce === true,
  };
}

function ExternalLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  );
}

function Problems({ messages }: { readonly messages: ReadonlyArray<string> }) {
  return messages.map((message) => (
    <StatusLine key={message} tone="error" className={READING_MEASURE_CLASS}>
      {message}
    </StatusLine>
  ));
}

const INTRO: Record<ServerMoveView, string> = {
  setup:
    "Majordome runs on this computer, so your routines only run while it is awake. A server of your own is a small computer you rent that never sleeps, so your routines run on time and your phone can always reach Majordome.",
  progress:
    "Majordome is setting up your server: a small rented computer that never sleeps, so your routines run even while this computer is off.",
  ready:
    "You have a server of your own: a small rented computer that never sleeps, with a copy of your notes. This page shows what is left to do on it, and how to remove it.",
  removing:
    "Majordome is removing your server. Your notes and routines come back to this computer.",
};

/** Set up a rented server that never sleeps from here, or follow the guide to do it by hand. */
export function AlwaysOnServerPage() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const { machineOf } = useMachineNames();
  // Someone on a server Majordome hosts already has what this page sets up.
  if (environmentId !== null && isHostedServer(machineOf(environmentId))) {
    return (
      <MajordomeSettingsPage
        searchId="majordome-always-on"
        intro="Majordome hosts your server. It never sleeps, so your routines run on time and your phone can always reach it. There is nothing to set up here."
      >
        {null}
      </MajordomeSettingsPage>
    );
  }
  return environmentId === null ? (
    <MajordomeSettingsPage searchId="majordome-always-on" intro={INTRO.setup}>
      <ManualGuide />
    </MajordomeSettingsPage>
  ) : (
    <ServerMovePage environmentId={environmentId} />
  );
}

const HOSTED_START_URL = "https://broker.majord.link/start";

function ManualGuide() {
  return (
    <Section>
      <Disclosure summary="Do it by hand">
        <AlwaysOnManualGuide />
      </Disclosure>
      <Disclosure summary="Let Majordome host it">
        <Muted>
          With an invite code, Majordome makes a server for you and looks after it: nothing to rent
          and nothing to install. It starts with new notes, and you sign in to Claude there with
          your own account. Open{" "}
          <ExternalLink href={HOSTED_START_URL}>broker.majord.link/start</ExternalLink> and enter
          your code.
        </Muted>
      </Disclosure>
    </Section>
  );
}

function ServerMovePage({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const result = useAtomValue(majordomeEnvironment.serverMove({ environmentId, input: {} }));
  const canManage = useAtomValue(
    majordomeEnvironment.serverMoveStart.permissionAtom(environmentId),
  );
  const status = AsyncResult.getOrElse(result, () => null);
  const view = status === null ? "setup" : serverMoveView(status);
  return (
    <MajordomeSettingsPage searchId="majordome-always-on" intro={INTRO[view]}>
      {!canManage ? (
        <Section>
          <Muted>Open this screen on the computer where Majordome runs to set up a server.</Muted>
        </Section>
      ) : status === null ? (
        <Section>
          {result._tag === "Failure" ? (
            <p className="text-sm text-destructive-foreground">
              {formatEnvironmentQueryError(result.cause)}
            </p>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </Section>
      ) : (
        <ServerMove environmentId={environmentId} status={status} />
      )}
      {view === "setup" ? <ManualGuide /> : null}
    </MajordomeSettingsPage>
  );
}

function ServerMove({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: MajordomeServerMoveStatus;
}) {
  switch (serverMoveView(status)) {
    case "setup":
      return <SetupPanel environmentId={environmentId} status={status} />;
    case "progress":
      return <ProgressPanel environmentId={environmentId} move={status.move!} />;
    case "ready":
      return (
        <ReadyPanel
          environmentId={environmentId}
          move={status.move!}
          hasKeys={status.keys.hetzner || status.keys.tailscale}
        />
      );
    case "removing":
      return (
        <Section label="Your server">
          <StatusLine tone="neutral">
            <span className="inline-flex items-center gap-2">
              <Spinner size="sm" /> Removing the server…
            </span>
          </StatusLine>
        </Section>
      );
  }
}

function RemovalSummary({ removal }: { readonly removal: MajordomeServerMoveRemoval }) {
  return (
    <Section label="The server was removed">
      <EntryList>
        {removal.did.map((line) => (
          <Entry key={line}>
            <StatusLine tone="ok">{line}</StatusLine>
          </Entry>
        ))}
        {removal.problems.map((line) => (
          <Entry key={line}>
            <StatusLine tone="warning">{line}</StatusLine>
          </Entry>
        ))}
      </EntryList>
    </Section>
  );
}

/** One key: its steps and a field while open, one line once saved or while it waits its turn. */
function KeyField({
  label,
  saved,
  open,
  placeholder,
  problems,
  onSave,
  onChange,
  onCancel,
  children,
}: {
  readonly label: string;
  readonly saved: boolean;
  readonly open: boolean;
  readonly placeholder: string;
  readonly problems: ReadonlyArray<string>;
  readonly onSave: (value: string) => Promise<string | null>;
  readonly onChange: () => void;
  readonly onCancel: () => void;
  /** How to get the key, step by step. */
  readonly children: ReactNode;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `always-on-${label.toLowerCase().replaceAll(" ", "-")}`;

  const save = async () => {
    setBusy(true);
    const problem = await onSave(value.trim());
    setBusy(false);
    setError(problem);
    if (problem === null) setValue("");
  };

  if (!open) {
    return (
      <Entry as="div" title={label}>
        {saved ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusLine tone="ok">Saved on this computer.</StatusLine>
            <Button size="xs" variant="ghost-muted" onClick={onChange}>
              Change
            </Button>
          </div>
        ) : (
          <Muted>Next, once the key above is saved.</Muted>
        )}
        <Problems messages={problems} />
      </Entry>
    );
  }
  return (
    <Entry as="div" title={<Label htmlFor={inputId}>{label}</Label>}>
      {children}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="min-w-0 flex-1 basis-56">
          <Input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        </div>
        <Button type="submit" size="sm" disabled={busy || value.trim() === ""}>
          {busy ? <Spinner size="sm" /> : null}
          Save
        </Button>
        {saved ? (
          <Button type="button" size="sm" variant="ghost-muted" disabled={busy} onClick={onCancel}>
            Keep the saved one
          </Button>
        ) : null}
      </form>
      {error === null ? null : <StatusLine tone="error">{error}</StatusLine>}
      <Problems messages={problems} />
    </Entry>
  );
}

/** Asks before deleting the saved keys, and says so when deleting them fails. */
function ForgetKeys({
  environmentId,
  disabled,
  consequence,
  onForgotten,
}: {
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
  /** What forgetting costs on the screen that offers it. */
  readonly consequence: string;
  readonly onForgotten?: () => void;
}) {
  const forgetKeys = useAtomCommand(majordomeEnvironment.serverMoveForgetKeys, {
    reportFailure: false,
  });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forget = async () => {
    setBusy(true);
    setError(null);
    const result = await forgetKeys({ environmentId, input: {} });
    setBusy(false);
    if (result._tag === "Success") {
      setAsking(false);
      onForgotten?.();
      return;
    }
    const failure = failureOf(result);
    if (failure !== null) {
      setError(`The keys could not be forgotten, so they are still saved. ${failure.message}`);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost-muted"
        disabled={disabled}
        onClick={() => {
          setError(null);
          setAsking(true);
        }}
      >
        Forget these keys
      </Button>
      <AlertDialog
        open={asking}
        onOpenChange={(open) => {
          if (!busy) setAsking(open);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget these keys?</AlertDialogTitle>
            <AlertDialogDescription>
              Majordome deletes the Hetzner key and the Tailscale secret from this computer.{" "}
              {consequence}
            </AlertDialogDescription>
            {error === null ? null : <StatusLine tone="error">{error}</StatusLine>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
              Keep the keys
            </AlertDialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => void forget()}>
              {busy ? <Spinner size="sm" /> : null}
              Forget the keys
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function SetupPanel({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: MajordomeServerMoveStatus;
}) {
  const { activeVault } = useMajordomeVaults();
  const projectId: ProjectId | null =
    activeVault?.copies.find((copy) => copy.environmentId === environmentId)?.projectId ?? null;
  const saveKeys = useAtomCommand(majordomeEnvironment.serverMoveSaveKeys, {
    reportFailure: false,
  });
  const runCheck = useAtomCommand(majordomeEnvironment.serverMoveCheck, { reportFailure: false });
  const start = useAtomCommand(majordomeEnvironment.serverMoveStart, { reportFailure: false });
  const [check, setCheck] = useState<MajordomeServerMoveCheck | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [changing, setChanging] = useState<ServerKey | null>(null);
  const [busy, setBusy] = useState<"check" | "start" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const location = chosenLocation(check, picked);
  const openKey = openServerKey(status.keys, changing);
  const action = serverSetupAction({ status, check, projectId });

  const save = async (input: { hetznerToken?: string; tailscaleSecret?: string }) => {
    const result = await saveKeys({ environmentId, input });
    if (result._tag === "Success") {
      // A new key makes the last check's verdict about the old one.
      setCheck(null);
      setChanging(null);
    }
    return failureOf(result)?.message ?? null;
  };

  const doCheck = async () => {
    if (projectId === null) return;
    setBusy("check");
    setError(null);
    const result = await runCheck({ environmentId, input: { projectId } });
    setBusy(null);
    if (result._tag === "Success") setCheck(result.value);
    else setError(failureOf(result)?.message ?? null);
  };

  const doStart = async () => {
    if (projectId === null || location === null) return;
    setBusy("start");
    setError(null);
    const result = await start({ environmentId, input: { projectId, location: location.name } });
    setBusy(null);
    setError(failureOf(result)?.message ?? null);
  };

  return (
    <>
      {status.removal === null ? null : <RemovalSummary removal={status.removal} />}
      <Section label="What you need">
        <EntryList>
          <Entry title="A Hetzner account, with a payment card">
            Hetzner is the company that rents you the server. The account is free; the server costs
            about €5 a month, billed by Hetzner to your card. Majordome charges nothing, and shows
            the exact price before anything is rented.
          </Entry>
          <Entry title="A Tailscale account">
            Tailscale is a free service that keeps the server private, so only your own devices can
            reach it.
          </Entry>
          <Entry title="About ten minutes">
            You copy one key from each account and paste it here. Majordome then rents the server,
            copies your notes to it and shows each step. You can remove the server from this screen
            at any time.
          </Entry>
        </EntryList>
      </Section>
      <Section label="Set up a server for me">
        {projectId === null ? (
          <StatusLine tone="warning" className="mb-3">
            Open a notes folder on this computer first.
          </StatusLine>
        ) : null}
        <KeyField
          label="1. Hetzner key"
          saved={status.keys.hetzner}
          open={openKey === "hetzner"}
          placeholder="Paste the API token"
          problems={problemsFor(check, "hetzner")}
          onSave={(hetznerToken) => save({ hetznerToken })}
          onChange={() => setChanging("hetzner")}
          onCancel={() => setChanging(null)}
        >
          <Steps>
            <Step>
              Open the <ExternalLink href={HETZNER_CONSOLE_URL}>Hetzner Console</ExternalLink> and
              sign in, or create an account. Hetzner asks for a payment card.
            </Step>
            <Step>Create a project, with any name, and open it.</Step>
            <Step>In the left menu choose Security, then API tokens, then Generate API token.</Step>
            <Step>Name it Majordome, choose Read &amp; Write, and generate it.</Step>
            <Step>Copy the token and paste it below. Hetzner shows it only once.</Step>
          </Steps>
        </KeyField>
        <KeyField
          label="2. Tailscale secret"
          saved={status.keys.tailscale}
          open={openKey === "tailscale"}
          placeholder="tskey-client-…"
          problems={problemsFor(check, "tailscale")}
          onSave={(tailscaleSecret) => save({ tailscaleSecret })}
          onChange={() => setChanging("tailscale")}
          onCancel={() => setChanging(null)}
        >
          <Muted>
            Tailscale calls its key a secret. These steps give Majordome the right to add one server
            to your Tailscale account, and nothing else.
          </Muted>
          <Steps>
            <Step>
              Open <ExternalLink href={TAILSCALE_TAGS_URL}>Access controls</ExternalLink> in
              Tailscale and sign in, or create an account. Choose Tags, then Create tag. Name it
              majordome and save.
            </Step>
            <Step>
              Open <ExternalLink href={TAILSCALE_CREDENTIALS_URL}>Trust credentials</ExternalLink>,
              choose Credential, then OAuth.
            </Step>
            <Step>
              In the list, find Auth Keys and set it to Write, then find Core under Devices and set
              it to Write. Each asks for a tag: choose tag:majordome. Leave everything else off.
            </Step>
            <Step>
              Generate the credential, copy its secret (it starts with tskey-client-) and paste it
              below. Tailscale shows it only once.
            </Step>
          </Steps>
        </KeyField>
        <div className="mt-3 flex flex-col gap-2">
          <Problems messages={problemsFor(check, "other")} />
          {check?.notices.map((notice) => (
            <StatusLine key={notice} tone="warning" className={READING_MEASURE_CLASS}>
              {notice}
            </StatusLine>
          ))}
          {action === "start" ? (
            <StatusLine tone="ok">Both keys work. Everything is ready.</StatusLine>
          ) : null}
          {check !== null && location !== null ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Label>Where</Label>
              <Select
                value={location.name}
                onValueChange={(name) => {
                  if (typeof name === "string") setPicked(name);
                }}
              >
                <SelectTrigger size="sm" aria-label="Where the server is">
                  <SelectValue>{locationLabel(location, check.currency)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {check.locations.map((choice) => (
                    <SelectItem key={choice.name} value={choice.name}>
                      {locationLabel(choice, check.currency)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
          {error === null ? null : <StatusLine tone="error">{error}</StatusLine>}
          {action === "check" && check === null ? (
            <Muted className={READING_MEASURE_CLASS}>
              Majordome checks that both keys work and reads the price from Hetzner. Nothing is
              rented yet.
            </Muted>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {action === "start" ? (
              <Button size="sm" disabled={busy !== null} onClick={() => void doStart()}>
                {busy === "start" ? <Spinner size="sm" /> : null}
                Set up a server for me
              </Button>
            ) : action === "check" ? (
              <Button size="sm" disabled={busy !== null} onClick={() => void doCheck()}>
                {busy === "check" ? <Spinner size="sm" /> : null}
                {check === null ? "Check my keys" : "Check again"}
              </Button>
            ) : null}
            {action === "start" ? (
              <Button
                size="sm"
                variant="ghost-muted"
                disabled={busy !== null}
                onClick={() => void doCheck()}
              >
                {busy === "check" ? <Spinner size="sm" /> : null}
                Check again
              </Button>
            ) : null}
            {status.keys.hetzner || status.keys.tailscale ? (
              <ForgetKeys
                environmentId={environmentId}
                disabled={busy !== null}
                consequence="To set up a server, you will have to make and paste them again."
                onForgotten={() => {
                  setCheck(null);
                  setChanging(null);
                }}
              />
            ) : null}
          </div>
        </div>
      </Section>
    </>
  );
}

function ProgressPanel({
  environmentId,
  move,
}: {
  readonly environmentId: EnvironmentId;
  readonly move: MajordomeServerMove;
}) {
  const retry = useAtomCommand(majordomeEnvironment.serverMoveRetry, { reportFailure: false });
  const cancel = useAtomCommand(majordomeEnvironment.serverMoveCancel, { reportFailure: false });
  const [stopping, setStopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failed = move.phase === "failed";

  const act = async (action: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    setStopping(false);
    setError(failureOf(result)?.message ?? null);
  };

  return (
    <Section label={failed ? "The setup stopped" : "Setting up your server"}>
      <EntryList>
        {serverMoveStepRows(move).map((row) => (
          <Entry
            key={row.id}
            title={
              <span className="flex items-center gap-2">
                {row.state === "working" ? <Spinner size="sm" /> : <ToneDot tone={row.tone} />}
                {row.label}
                <span className="sr-only">: {row.stateLabel}</span>
              </span>
            }
          >
            {row.problem === null ? null : <p className={READING_MEASURE_CLASS}>{row.problem}</p>}
          </Entry>
        ))}
      </EntryList>
      {move.server === null ? null : (
        <Muted className="mt-2">{serverSummary(move)}. Hetzner bills it while it exists.</Muted>
      )}
      {error === null ? null : (
        <StatusLine tone="error" className="mt-2">
          {error}
        </StatusLine>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {failed ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void act(() => retry({ environmentId, input: {} }))}
          >
            Try again
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setStopping(true)}>
          Stop
        </Button>
      </div>
      <AlertDialog open={stopping} onOpenChange={setStopping}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop setting up the server?</AlertDialogTitle>
            <AlertDialogDescription>
              Majordome removes what it made at Hetzner and on your Tailscale network, so nothing is
              billed. Your notes on this computer are not touched.
              {failed
                ? ""
                : " You can also keep what was made and try again later; Hetzner bills the server while it exists."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
              Go on
            </AlertDialogClose>
            {failed ? null : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act(() => cancel({ environmentId, input: { keep: true } }))}
              >
                Stop and keep it
              </Button>
            )}
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void act(() => cancel({ environmentId, input: { keep: false } }))}
            >
              {busy ? <Spinner size="sm" /> : null}
              Stop and remove it
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Section>
  );
}

function ReadyPanel({
  environmentId,
  move,
  hasKeys,
}: {
  readonly environmentId: EnvironmentId;
  readonly move: MajordomeServerMove;
  readonly hasKeys: boolean;
}) {
  const serverId = move.server?.environmentId ?? null;
  const { environments, isReady } = useEnvironments();
  const providers = useEnvironmentProviders();
  const saved = serverId !== null && environments.some((entry) => entry.environmentId === serverId);
  const providerReady = serverId !== null && hasReadyProvider(providers.get(serverId));
  const next = serverMoveNextStep({ move, saved, providerReady });

  const issueLink = useAtomCommand(majordomeEnvironment.serverMoveIssuePairingLink, {
    reportFailure: false,
  });
  const pair = useAtomCommand(connectPairing, { reportFailure: false });
  const moveRoutines = useAtomCommand(majordomeEnvironment.serverMoveRoutines, {
    reportFailure: false,
  });
  const remove = useAtomCommand(majordomeEnvironment.serverMoveRemove, { reportFailure: false });
  const forget = useAtomCommand(environmentCatalog.remove, { reportFailure: false });
  const messages = useMessages();
  const accountsPage = messages(SETTINGS_SECTION_LABELS["/settings/providers"]);
  const [busy, setBusy] = useState<"add" | "routines" | "remove" | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [routinesError, setRoutinesError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ readonly problem: string | null } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const addToApp = async () => {
    setBusy("add");
    setAddError(null);
    const link = await issueLink({ environmentId, input: {} });
    if (link._tag === "Failure") {
      setBusy(null);
      setAddError(failureOf(link)?.message ?? null);
      return;
    }
    const added = await pair({
      pairingUrl: link.value.pairingUrl,
      ...(serverId === null ? {} : { expectedEnvironmentId: serverId }),
    });
    setBusy(null);
    setAddError(failureOf(added)?.message ?? null);
  };

  // One try per visit, so a server that refuses does not ask for a new code on every render.
  const triedAdding = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Saved environments live in this app's own storage; a server made elsewhere is added to it once it is ready.
  useEffect(() => {
    if (!isReady || saved || triedAdding.current) return;
    triedAdding.current = true;
    void addToApp();
  });

  const doMoveRoutines = async () => {
    setBusy("routines");
    setRoutinesError(null);
    const result = await moveRoutines({ environmentId, input: {} });
    setBusy(null);
    setRoutinesError(failureOf(result)?.message ?? null);
  };

  const doRemove = async (force: boolean) => {
    setBusy("remove");
    setRemoveError(null);
    const result = await remove({ environmentId, input: { force } });
    setBusy(null);
    const failure = failureOf(result);
    if (failure?.canForce) {
      setRemoving({ problem: failure.message });
      return;
    }
    setRemoving(null);
    setRemoveError(failure?.message ?? null);
    // The server is gone; this app's saved connection to it goes with it.
    if (result._tag === "Success" && serverId !== null) void forget(serverId);
  };

  const signInLink =
    serverId === null ? null : (
      <Link
        to="/settings/providers"
        search={{ environmentId: serverId }}
        className="underline underline-offset-2"
      >
        Sign in to Claude on the server
      </Link>
    );

  return (
    <>
      <Section label="Your server">
        <StatusLine tone="ok" className={READING_MEASURE_CLASS}>
          Running at <span className="font-medium break-all">{move.server?.url}</span>, with your
          notes on it. Only your devices on your Tailscale network can reach it.
        </StatusLine>
        <Muted className="mt-1">{serverSummary(move)}</Muted>
      </Section>
      <Section label={next === "done" ? "Done" : "What is left"}>
        <Steps>
          <Step title="Add it to this app">
            {saved ? (
              <StatusLine tone="ok">It is in this app. Its chats show beside yours.</StatusLine>
            ) : busy === "add" ? (
              <StatusLine tone="neutral">
                <span className="inline-flex items-center gap-2">
                  <Spinner size="sm" /> Adding it…
                </span>
              </StatusLine>
            ) : (
              <>
                {addError === null ? null : <StatusLine tone="error">{addError}</StatusLine>}
                <Button size="xs" variant="outline" onClick={() => void addToApp()}>
                  Add it to this app
                </Button>
              </>
            )}
          </Step>
          <Step title="Sign in to Claude on the server">
            {providerReady ? (
              <StatusLine tone="ok">Signed in.</StatusLine>
            ) : (
              <>
                Sign-ins are not copied: each computer has its own. Open the server's {accountsPage}{" "}
                page, choose Sign in to Claude (or Continue with ChatGPT), and follow the link it
                shows.
                {saved ? <span className="block">{signInLink}</span> : null}
              </>
            )}
          </Step>
          <Step title="Move routines to the server">
            {move.routinesOnServer ? (
              <StatusLine tone="ok">
                Routines run on the server, whether this computer is awake or not.
              </StatusLine>
            ) : (
              <>
                Until then they keep running on this computer.
                {routinesError === null ? null : (
                  <StatusLine tone="error">{routinesError}</StatusLine>
                )}
                <span className="block">
                  <Button
                    size="xs"
                    disabled={busy !== null || next !== "move-routines"}
                    onClick={() => void doMoveRoutines()}
                  >
                    {busy === "routines" ? <Spinner size="sm" /> : null}
                    Move routines now
                  </Button>
                </span>
              </>
            )}
          </Step>
          <Step title="Set up your phone">
            {move.routinesOnServer ? (
              <>
                Your phone can reach the server from anywhere, with nothing to install on it.{" "}
                <Link to="/settings/phone" className="underline underline-offset-2">
                  Set up your phone
                </Link>
              </>
            ) : (
              "Once routines run on the server, this step links to the page that sets up your phone on it."
            )}
          </Step>
        </Steps>
      </Section>
      <Section label="Remove this server">
        <Muted className={READING_MEASURE_CLASS}>
          Majordome copies the notes changed on the server back to this computer, moves routines
          back here, then deletes the server at Hetzner and its entry in Tailscale. Hetzner stops
          billing it. Removing needs both keys: Majordome keeps them on this computer until you
          choose Forget these keys, and asks for them again if you have.
        </Muted>
        {removeError === null ? null : (
          <StatusLine tone="error" className="mt-2">
            {removeError}
          </StatusLine>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="destructive-outline"
            disabled={busy !== null}
            onClick={() => setRemoving({ problem: null })}
          >
            Remove this server
          </Button>
          {hasKeys ? (
            <ForgetKeys
              environmentId={environmentId}
              disabled={busy !== null}
              consequence="Your server keeps running. Removing it later needs both keys, so Majordome will ask you to paste them again."
            />
          ) : null}
        </div>
        <AlertDialog
          open={removing !== null}
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
        >
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {removing?.problem ? "Remove it anyway?" : "Remove this server?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {removing?.problem ??
                  "Your notes and routines come back to this computer first. The server, its firewall and its Tailscale entry are then deleted for good."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose
                disabled={busy !== null}
                render={<Button variant="outline" disabled={busy !== null} />}
              >
                Keep it
              </AlertDialogClose>
              <Button
                variant="destructive"
                disabled={busy !== null}
                onClick={() => void doRemove(Boolean(removing?.problem))}
              >
                {busy === "remove" ? <Spinner size="sm" /> : null}
                {removing?.problem ? "Remove anyway" : "Remove it"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </Section>
    </>
  );
}
