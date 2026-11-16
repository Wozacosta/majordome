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
import { type ReactNode, useEffect, useRef, useState } from "react";

import { environmentCatalog } from "../../connection/catalog";
import { connectPairing } from "../../connection/onboarding";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { majordomeEnvironment } from "../../state/majordome";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatExpiresInLabel } from "../../timestampFormat";
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
import { QRCodeSvg } from "../ui/qr-code";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { AlwaysOnManualGuide } from "./AlwaysOnManualGuide";
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
  Surface,
  ToneDot,
} from "./paper";
import {
  canStartServerMove,
  chosenLocation,
  hasReadyProvider,
  locationLabel,
  problemsFor,
  serverMoveNextStep,
  serverMoveStepRows,
  serverMoveView,
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

/** Set up a rented server that never sleeps from here, or follow the guide to do it by hand. */
export function AlwaysOnServerPage() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  return (
    <MajordomeSettingsPage
      searchId="majordome-always-on"
      intro="Majordome runs on this computer, so your routines only run while it is awake. An always-on server is a small computer you rent that never sleeps. Majordome can set one up for you in about ten minutes."
    >
      {environmentId === null ? null : <ServerMove environmentId={environmentId} />}
      <Section>
        <Disclosure summary="Do it by hand">
          <AlwaysOnManualGuide />
        </Disclosure>
      </Section>
    </MajordomeSettingsPage>
  );
}

function ServerMove({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const result = useAtomValue(majordomeEnvironment.serverMove({ environmentId, input: {} }));
  const canManage = useAtomValue(
    majordomeEnvironment.serverMoveStart.permissionAtom(environmentId),
  );
  const status = AsyncResult.getOrElse(result, () => null);

  if (!canManage) {
    return (
      <Section>
        <Muted>Open this screen on the computer where Majordome runs to set up a server.</Muted>
      </Section>
    );
  }
  if (status === null) {
    return (
      <Section>
        {result._tag === "Failure" ? (
          <p className="text-sm text-destructive-foreground">
            {formatEnvironmentQueryError(result.cause)}
          </p>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </Section>
    );
  }
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

function KeyField({
  label,
  saved,
  placeholder,
  problems,
  onSave,
  children,
}: {
  readonly label: string;
  readonly saved: boolean;
  readonly placeholder: string;
  readonly problems: ReadonlyArray<string>;
  readonly onSave: (value: string) => Promise<string | null>;
  /** How to get the key, step by step. */
  readonly children: ReactNode;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const inputId = `always-on-${label.toLowerCase().replaceAll(" ", "-")}`;

  const save = async () => {
    setBusy(true);
    const problem = await onSave(value.trim());
    setBusy(false);
    setError(problem);
    if (problem === null) {
      setValue("");
      setReplacing(false);
    }
  };

  return (
    <Entry as="div" title={<Label htmlFor={inputId}>{label}</Label>}>
      {saved && !replacing ? null : children}
      {saved && !replacing ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusLine tone="ok">Saved on this computer.</StatusLine>
          <Button size="xs" variant="ghost-muted" onClick={() => setReplacing(true)}>
            Replace
          </Button>
        </div>
      ) : (
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
        </form>
      )}
      {error === null ? null : <StatusLine tone="error">{error}</StatusLine>}
      <Problems messages={problems} />
    </Entry>
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
  const forgetKeys = useAtomCommand(majordomeEnvironment.serverMoveForgetKeys, {
    reportFailure: false,
  });
  const runCheck = useAtomCommand(majordomeEnvironment.serverMoveCheck, { reportFailure: false });
  const start = useAtomCommand(majordomeEnvironment.serverMoveStart, { reportFailure: false });
  const [check, setCheck] = useState<MajordomeServerMoveCheck | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "start" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const location = chosenLocation(check, picked);
  const hasKeys = status.keys.hetzner && status.keys.tailscale;

  const save = async (input: { hetznerToken?: string; tailscaleSecret?: string }) => {
    const result = await saveKeys({ environmentId, input });
    // A new key makes the last check's verdict about the old one.
    if (result._tag === "Success") setCheck(null);
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
      <Section label="Set up a server for me">
        <Muted className={READING_MEASURE_CLASS}>
          Majordome rents a small server from Hetzner in your name, keeps it private on your
          Tailscale network so only your devices can reach it, and copies your notes to it. Hetzner
          bills you for it each month; Majordome charges nothing. You paste two keys once, press one
          button, then sign in to Claude on the server. You can remove the server from this screen
          at any time.
        </Muted>
        {projectId === null ? (
          <StatusLine tone="warning" className="mt-3">
            Open a notes folder on this computer first.
          </StatusLine>
        ) : null}
        <div className="mt-3">
          <KeyField
            label="Hetzner key"
            saved={status.keys.hetzner}
            placeholder="Paste the API token"
            problems={problemsFor(check, "hetzner")}
            onSave={(hetznerToken) => save({ hetznerToken })}
          >
            <Steps>
              <Step>
                Open the <ExternalLink href={HETZNER_CONSOLE_URL}>Hetzner Console</ExternalLink> and
                sign in, or create an account. Hetzner asks for a way to pay.
              </Step>
              <Step>Create a project named Majordome and open it.</Step>
              <Step>
                In the left menu choose Security, then API tokens, then Generate API token.
              </Step>
              <Step>Name it Majordome, choose Read &amp; Write, and generate it.</Step>
              <Step>Copy the token and paste it below. Hetzner shows it only once.</Step>
            </Steps>
          </KeyField>
          <KeyField
            label="Tailscale secret"
            saved={status.keys.tailscale}
            placeholder="tskey-client-…"
            problems={problemsFor(check, "tailscale")}
            onSave={(tailscaleSecret) => save({ tailscaleSecret })}
          >
            <Steps>
              <Step>
                Open <ExternalLink href={TAILSCALE_TAGS_URL}>Access controls</ExternalLink> in
                Tailscale, choose Tags, then Create tag. Name it majordome and save.
              </Step>
              <Step>
                Open <ExternalLink href={TAILSCALE_CREDENTIALS_URL}>Trust credentials</ExternalLink>
                , choose Credential, then OAuth.
              </Step>
              <Step>
                Set Auth Keys to Write and Devices &gt; Core to Write, and for each choose the tag
                tag:majordome. Leave everything else off.
              </Step>
              <Step>
                Generate the credential, copy its secret (it starts with tskey-client-) and paste it
                below. Tailscale shows it only once.
              </Step>
            </Steps>
          </KeyField>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <Problems messages={problemsFor(check, "other")} />
          {check?.notices.map((notice) => (
            <StatusLine key={notice} tone="warning" className={READING_MEASURE_CLASS}>
              {notice}
            </StatusLine>
          ))}
          {check !== null && check.problems.length === 0 ? (
            <StatusLine tone="ok">Everything is ready.</StatusLine>
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy !== null || !canStartServerMove({ status, check, projectId })}
              onClick={() => void doStart()}
            >
              {busy === "start" ? <Spinner size="sm" /> : null}
              Set up a server for me
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || !hasKeys || projectId === null}
              onClick={() => void doCheck()}
            >
              {busy === "check" ? <Spinner size="sm" /> : null}
              {check === null ? "Check" : "Check again"}
            </Button>
            {status.keys.hetzner || status.keys.tailscale ? (
              <Button
                size="sm"
                variant="ghost-muted"
                disabled={busy !== null}
                onClick={() => {
                  setCheck(null);
                  void forgetKeys({ environmentId, input: {} });
                }}
              >
                Forget these keys
              </Button>
            ) : null}
          </div>
          {check === null && hasKeys ? (
            <Muted>
              Check first: Majordome confirms both keys work and reads the price from Hetzner.
            </Muted>
          ) : null}
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

/** A one-time link to add the server to a phone, as a QR code. It lives only in this component. */
function PhoneCode({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const issue = useAtomCommand(majordomeEnvironment.serverMoveIssuePairingLink, {
    reportFailure: false,
  });
  const [code, setCode] = useState<{ readonly url: string; readonly expiresAt: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = async () => {
    setBusy(true);
    const result = await issue({ environmentId, input: {} });
    setBusy(false);
    setError(failureOf(result)?.message ?? null);
    if (result._tag === "Success") {
      setCode({ url: result.value.pairingUrl, expiresAt: result.value.expiresAt });
    }
  };

  if (code === null) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void show()}>
            {busy ? <Spinner size="sm" /> : null}
            Show the code
          </Button>
        </div>
        {error === null ? null : <StatusLine tone="error">{error}</StatusLine>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {/* White in both themes: a phone's camera reads dark squares on white. */}
      <Surface className="w-fit bg-white p-3">
        <QRCodeSvg
          value={code.url}
          size={168}
          level="M"
          marginSize={1}
          title="Code to open your server on your phone"
        />
      </Surface>
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{formatExpiresInLabel(code.expiresAt)}. Works once.</span>
        <Button size="xs" variant="ghost-muted" onClick={() => setCode(null)}>
          Hide
        </Button>
      </div>
    </div>
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
  const forgetKeys = useAtomCommand(majordomeEnvironment.serverMoveForgetKeys, {
    reportFailure: false,
  });
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
              <StatusLine tone="ok">
                It is in this app. Its conversations show beside yours.
              </StatusLine>
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
                Sign-ins are not copied: each machine has its own. Open the server's Providers,
                choose Sign in to Claude (or Continue with ChatGPT), and follow the link it shows.
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
          <Step title="Add it to your phone">
            Open Tailscale on your phone, then scan this code with its camera.
            <PhoneCode environmentId={environmentId} />
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
            <Button
              size="sm"
              variant="ghost-muted"
              disabled={busy !== null}
              onClick={() => void forgetKeys({ environmentId, input: {} })}
            >
              Forget these keys
            </Button>
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
