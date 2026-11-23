import { HOSTED_SERVER_NAME } from "@t3tools/shared/majordome";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { phoneSetupRevision } from "@t3tools/client-runtime/state/majordome";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  type AuthSessionId,
  AuthStandardClientScopes,
  type EnvironmentId,
  type MajordomePhoneSetup,
  type MajordomePushDevice,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { hasAccountPublicConfig } from "../../cloud/publicConfig";
import { cn } from "../../lib/utils";
import { authEnvironment } from "../../state/auth";
import { majordomeEnvironment } from "../../state/majordome";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatExpiresInLabel } from "../../timestampFormat";
import { resolveDesktopPairingUrl } from "../settings/pairingUrls";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { SettingsSearchTarget } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { QRCodeSvg } from "../ui/qr-code";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import { NotificationsSections } from "./NotificationsSections";
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
} from "./paper";
import {
  anywhereView,
  computerSetupProgress,
  currentAnywhere,
  NOTIFICATIONS_ANCHOR,
  PHONE_PAIRING_LABEL,
  PHONE_SIGN_IN_ADDRESS,
  type PairedPhone,
  pairedPhones,
  phoneComputerWords,
  type PhoneSignIn,
  phoneSignIn,
  type PhoneStepState,
  phoneStepStates,
  phoneWays,
  phoneWithNotifications,
  phoneAppPairingLink,
} from "./phone.logic";
import { isHostedServer } from "./brains.logic";
import { useMachineNames } from "./useMachineNames";
import { readIsOnPhone } from "./pushNotifications";
import { usePhoneEnvironment } from "./usePhoneEnvironment";

const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
const TAILSCALE_DNS_SETTINGS_URL = "https://login.tailscale.com/admin/dns";
const ANYWHERE_RECHECK_MS = 3000;

export function PhonePage() {
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const target = usePhoneEnvironment();
  const [onPhone] = useState(readIsOnPhone);
  return (
    <MajordomeSettingsPage searchId="majordome-phone">
      {onPhone ? (
        <OnPhone />
      ) : target === null ? (
        primaryEnvironmentId === null ? null : (
          <Section label="Set up your phone">
            <Skeleton className="h-24 w-full" />
          </Section>
        )
      ) : (
        <PhoneSetupSection
          environmentId={target.environmentId}
          elsewhere={target.isThisComputer ? null : target.name}
          ownEnvironmentId={target.isThisComputer ? null : primaryEnvironmentId}
        />
      )}
      <SettingsSearchTarget id={NOTIFICATIONS_ANCHOR} className="outline-none">
        {/* Without it, a jump here would center the whole part instead of its top. */}
        <span data-settings-scroll-target aria-hidden className="block" />
        <NotificationsSections />
      </SettingsSearchTarget>
    </MajordomeSettingsPage>
  );
}

function OnPhone() {
  return (
    <Section>
      <StatusLine tone="ok">You're on your phone</StatusLine>
      <Muted className="mt-2">
        Majordome is set up here. Choose below whether this phone gets notifications.
      </Muted>
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

function PhoneSetupSection({
  environmentId,
  elsewhere,
  ownEnvironmentId,
}: {
  /** The computer the phone is set up on. */
  readonly environmentId: EnvironmentId;
  /** Its name when it is another computer than this one. */
  readonly elsewhere: string | null;
  /** This computer, when the phone is set up on another one. */
  readonly ownEnvironmentId: EnvironmentId | null;
}) {
  const result = useAtomValue(majordomeEnvironment.phoneSetup({ environmentId, input: {} }));
  const bumpRevision = useAtomSet(phoneSetupRevision(environmentId));
  const checkAgain = () => bumpRevision((value) => value + 1);
  const setup = AsyncResult.getOrElse(result, () => null);
  const devices = useAtomValue(majordomeEnvironment.pushDevices({ environmentId, input: {} }));
  const phone = phoneWithNotifications(AsyncResult.getOrElse(devices, () => null)?.devices ?? []);
  const canSeeAccess = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const access = useEnvironmentQuery(
    canSeeAccess ? authEnvironment.accessChanges({ environmentId, input: null }) : null,
  );
  const phones =
    access.data?.type === "snapshot" ? pairedPhones(access.data.payload.clientSessions) : null;
  const steps = phoneStepStates({ paired: phones?.length ?? null, notified: phone });
  const hasAccounts = hasAccountPublicConfig();
  const accountResult = useAtomValue(majordomeEnvironment.account({ environmentId, input: {} }));
  // Waiting for it keeps the page from leading with the code, then with signing in.
  const accountPending = hasAccounts && accountResult._tag === "Initial";

  const connecting = setup?.anywhere.state === "starting";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A real timer: while the computer is still connecting its address, only asking it again shows when the address is ready.
  useEffect(() => {
    if (!connecting) return;
    const timer = setInterval(() => bumpRevision((value) => value + 1), ANYWHERE_RECHECK_MS);
    return () => clearInterval(timer);
  }, [connecting, bumpRevision]);

  return (
    <>
      <Section label="Set up your phone">
        {elsewhere === null ? null : (
          <Muted className={cn(READING_MEASURE_CLASS, "mb-3")}>
            Your phone connects to {phoneComputerWords(elsewhere).inSentence}, which is always on
            and runs your routines.
          </Muted>
        )}
        {phone === null ? null : (
          <StatusLine tone="ok" className={cn(READING_MEASURE_CLASS, "mb-3")}>
            Your phone is set up: {phone} gets notifications. Follow the steps again to add another
            phone.
          </StatusLine>
        )}
        {setup === null ? (
          result._tag === "Failure" ? (
            <p className="text-sm text-destructive-foreground">
              {formatEnvironmentQueryError(result.cause)}
            </p>
          ) : (
            <Skeleton className="h-24 w-full" />
          )
        ) : accountPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <PhoneWays
            environmentId={environmentId}
            elsewhere={elsewhere}
            setup={setup}
            signIn={phoneSignIn(
              hasAccounts,
              AsyncResult.getOrElse(accountResult, () => null),
            )}
            steps={steps}
            onCheckAgain={checkAgain}
            checking={result.waiting}
          />
        )}
        {ownEnvironmentId === null ? null : <OwnAddress environmentId={ownEnvironmentId} />}
      </Section>
      {phones === null || phones.length === 0 ? null : (
        <PairedPhones
          environmentId={environmentId}
          phones={phones}
          devices={AsyncResult.getOrElse(devices, () => null)?.devices ?? []}
        />
      )}
    </>
  );
}

type PhoneSteps = ReturnType<typeof phoneStepStates>;

/** The phones that can open Majordome on a computer, each with a way to take that away. */
function PairedPhones({
  environmentId,
  phones,
  devices,
}: {
  readonly environmentId: EnvironmentId;
  readonly phones: ReadonlyArray<PairedPhone>;
  /** The devices that get notifications from this computer. */
  readonly devices: ReadonlyArray<MajordomePushDevice>;
}) {
  const canRemove = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  const revoke = useAtomCommand(authEnvironment.revokeClient, { reportFailure: false });
  const stopNotifying = useAtomCommand(majordomeEnvironment.removePushSubscription, {
    reportFailure: false,
  });
  // The dialog keeps the phone's name while it closes.
  const [asking, setAsking] = useState<PairedPhone | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removing, setRemoving] = useState<AuthSessionId | null>(null);

  const remove = async (sessionId: AuthSessionId) => {
    setDialogOpen(false);
    setRemoving(sessionId);
    const result = await revoke({ environmentId, input: { sessionId } });
    if (result._tag !== "Failure") {
      // A phone that can no longer open Majordome is not sent what happens in it either.
      await Promise.all(
        devices
          .filter((device) => device.sessionId === sessionId)
          .map((device) => stopNotifying({ environmentId, input: { endpoint: device.endpoint } })),
      );
    }
    setRemoving(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not remove this phone",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Section label="Phones that can open Majordome">
      <EntryList>
        {phones.map((phone) => (
          <Entry
            key={phone.sessionId}
            title={phone.name}
            meta={`Added ${new Date(phone.addedAt).toLocaleString(undefined, {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })}`}
            aside={phone.connected ? <Badge variant="secondary">Open now</Badge> : null}
            actions={
              <Button
                size="xs"
                variant="outline"
                disabled={!canRemove || removing !== null}
                onClick={() => {
                  setAsking(phone);
                  setDialogOpen(true);
                }}
              >
                {removing === phone.sessionId ? <Spinner size="sm" /> : null}
                Remove this phone
              </Button>
            }
          />
        ))}
      </EntryList>
      <Muted className={cn(READING_MEASURE_CLASS, "mt-2 text-xs")}>
        Lost a phone? Remove it here. Every other device that can open Majordome is in{" "}
        <Link to="/settings/access" className="underline underline-offset-2">
          Sharing & access
        </Link>
        .
      </Muted>
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {asking?.name ?? "this phone"}?</AlertDialogTitle>
            <AlertDialogDescription>
              It can no longer open Majordome, and it stops getting notifications. To use it again,
              scan a new code from this screen. If it still shows under the devices that get
              notifications, remove it there too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Keep this phone
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => (asking === null ? undefined : void remove(asking.sessionId))}
            >
              Remove this phone
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Section>
  );
}

function PhoneWays({
  environmentId,
  elsewhere,
  setup,
  signIn,
  steps,
  onCheckAgain,
  checking,
}: {
  readonly environmentId: EnvironmentId;
  readonly elsewhere: string | null;
  readonly setup: MajordomePhoneSetup;
  /** Null where there are no accounts: the code then leads, as it always did. */
  readonly signIn: PhoneSignIn | null;
  readonly steps: PhoneSteps;
  readonly onCheckAgain: () => void;
  readonly checking: boolean;
}) {
  const ways = phoneWays(setup);
  const { machineOf } = useMachineNames();
  const hosted = isHostedServer(machineOf(environmentId));
  const anywhere = (
    <AnywhereAddress
      environmentId={environmentId}
      elsewhere={elsewhere}
      hosted={hosted}
      anywhere={setup.anywhere}
      tailscaleOnly={ways.tailscaleOnly}
      steps={steps}
      checking={checking}
    />
  );
  const leading =
    signIn === null ? (
      anywhere
    ) : (
      <>
        <SignInWay
          signIn={signIn}
          computer={phoneComputerWords(hosted ? HOSTED_SERVER_NAME : elsewhere)}
          steps={steps}
        />
        <Disclosure className="mt-4" summary={CODE_WAY_SUMMARY}>
          {anywhere}
        </Disclosure>
      </>
    );
  // Tailscale and Wi-Fi are read from, and set up on, the computer in front of the owner. A server
  // Majordome hosts is no one's computer and has its address already.
  if (elsewhere !== null || hosted) return leading;
  return (
    <>
      {leading}
      <Disclosure
        className={signIn === null ? "mt-4" : undefined}
        summary="More private: only your own devices"
        open={ways.tailscaleOpen}
      >
        <Muted className={READING_MEASURE_CLASS}>
          Tailscale is an app that links your own devices privately, so this computer needs no
          address on the internet. It takes about 10 minutes: you install Tailscale on this computer
          and on your phone, with a free account.
        </Muted>
        {ways.bothInUse ? (
          <Muted className={READING_MEASURE_CLASS}>
            A phone set up one way keeps working that way. To change a phone to the other way, add
            Majordome to its Home Screen again from the new code.
          </Muted>
        ) : null}
        <SetupChecklist
          environmentId={environmentId}
          setup={setup}
          steps={steps}
          onCheckAgain={onCheckAgain}
          checking={checking}
        />
      </Disclosure>
      <Disclosure summary="On the same Wi-Fi only, without notifications">
        {setup.wifiUrls.length > 0 ? (
          <>
            <Muted className={READING_MEASURE_CLASS}>
              When your phone is on the same Wi-Fi as this computer, it can open Majordome with
              nothing else set up. Phones can't get notifications this way, and it stops working
              away from home.
            </Muted>
            <PairingCode
              environmentId={environmentId}
              elsewhere={null}
              baseUrl={setup.wifiUrls[0]!}
            />
          </>
        ) : (
          <Muted className={READING_MEASURE_CLASS}>
            This computer only accepts connections from itself right now, so Wi-Fi pairing is off.
            Use the steps above instead.
          </Muted>
        )}
      </Disclosure>
    </>
  );
}

const CODE_WAY_SUMMARY = "No account? Use a code instead";

/** Who an address on the internet lets in; with accounts, signing in is a way in too. */
const whoGetsIn = () =>
  hasAccountPublicConfig()
    ? "only devices signed in to your account, or added with a code from this screen, can get in"
    : "only devices you add with a code from this screen can get in";

/** The first way where there are accounts: the phone signs in and finds this computer, no code. */
function SignInWay({
  signIn,
  computer,
  steps,
}: {
  readonly signIn: PhoneSignIn;
  readonly computer: ReturnType<typeof phoneComputerWords>;
  readonly steps: PhoneSteps;
}) {
  const yourAccount = (
    <Link to="/settings/account" className="underline underline-offset-2">
      Your account
    </Link>
  );
  return (
    <Steps>
      <SetupStep title="Open Majordome on your phone" done={steps.open}>
        {signIn.kind === "ready" ? (
          <>
            <p>
              On your phone, open{" "}
              <ExternalLink href={`https://${PHONE_SIGN_IN_ADDRESS}`}>
                {PHONE_SIGN_IN_ADDRESS}
              </ExternalLink>{" "}
              in the browser and sign in
              {signIn.email === null ? " with your Majordome account" : ` as ${signIn.email}`}.{" "}
              {computer.atStart} is listed there: press Open. There is no code to scan.
            </p>
            <p>If you have the Majordome iPhone app, choose Sign in there instead.</p>
          </>
        ) : signIn.kind === "needs-account" ? (
          <p>
            Your phone can open Majordome by signing in, with no code to scan, once{" "}
            {computer.inSentence} is in your Majordome account. Add it in {yourAccount}, then come
            back here.
          </p>
        ) : (
          <p>
            {computer.atStart} is in your account, but your phone can't reach it yet: it needs an
            address. Give it one in {yourAccount}, then come back here.
          </p>
        )}
      </SetupStep>
      <AfterOpeningSteps
        steps={steps}
        newCode={`open “${CODE_WAY_SUMMARY}” below, press “Show the code”`}
      />
    </Steps>
  );
}

type Anywhere = MajordomePhoneSetup["anywhere"];

/** The main way: an address on the internet that a phone opens with nothing installed. */
function AnywhereAddress({
  environmentId,
  elsewhere,
  hosted,
  anywhere: read,
  tailscaleOnly,
  steps,
  checking,
}: {
  readonly environmentId: EnvironmentId;
  readonly elsewhere: string | null;
  /** A server Majordome hosts: its address is its own, with no tunnel to turn on or off. */
  readonly hosted: boolean;
  readonly anywhere: Anywhere;
  /** A phone may already work through Tailscale, so the offer says it keeps working. */
  readonly tailscaleOnly: boolean;
  readonly steps: PhoneSteps;
  readonly checking: boolean;
}) {
  const canChange = useAtomValue(
    majordomeEnvironment.enableAnywhereAddress.permissionAtom(environmentId),
  );
  const enable = useAtomCommand(majordomeEnvironment.enableAnywhereAddress, {
    reportFailure: false,
  });
  const disable = useAtomCommand(majordomeEnvironment.disableAnywhereAddress, {
    reportFailure: false,
  });
  // The dialog keeps its words while it closes, so what it asks stays apart from whether it shows.
  const [asking, setAsking] = useState<"on" | "off">("on");
  const [dialogOpen, setDialogOpen] = useState(false);
  const ask = (change: "on" | "off") => {
    setAsking(change);
    setDialogOpen(true);
  };
  const [busy, setBusy] = useState<"on" | "off" | null>(null);
  const [answered, setAnswered] = useState<Anywhere | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (change: "on" | "off") => {
    setDialogOpen(false);
    setBusy(change);
    setError(null);
    const result = await (change === "on" ? enable : disable)({ environmentId, input: {} });
    setBusy(null);
    if (result._tag === "Success") {
      setAnswered(result.value.anywhere);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const failure = squashAtomCommandFailure(result);
    setError(failure instanceof Error ? failure.message : String(failure));
  };

  const anywhere = currentAnywhere(read, answered, checking);
  const view = anywhereView(anywhere, busy === "on");
  const computer = phoneComputerWords(hosted ? HOSTED_SERVER_NAME : elsewhere);
  const problem =
    error === null ? null : <p className="text-sm text-destructive-foreground">{error}</p>;
  const notAllowed = canChange || elsewhere === null ? null : <NotAllowed name={elsewhere} />;

  return (
    <div className="flex flex-col gap-3">
      {view.kind === "offer" ? (
        <>
          <Muted className={READING_MEASURE_CLASS}>
            Majordome gives {computer.inSentence} its own address, and your phone opens it by
            scanning a code. Nothing to install on your phone, and no account to make.
            {tailscaleOnly
              ? " A phone you already set up through Tailscale keeps working as it is."
              : null}
          </Muted>
          <div>
            <Button disabled={!canChange} onClick={() => ask("on")}>
              Set up my phone
            </Button>
          </div>
          {notAllowed}
          {problem}
        </>
      ) : view.kind === "starting" ? (
        <StatusLine tone="neutral" className={READING_MEASURE_CLASS} aria-live="polite">
          Getting your address… This can take up to half a minute.
        </StatusLine>
      ) : view.kind === "unavailable" ? (
        <>
          <StatusLine tone="warning" className={READING_MEASURE_CLASS}>
            {view.reason ?? `${computer.atStart} can't get an address right now.`}
          </StatusLine>
          {elsewhere === null ? (
            <Muted className={READING_MEASURE_CLASS}>
              You can still set up your phone the more private way, in the steps below. It takes
              about 10 minutes.
            </Muted>
          ) : null}
          <div>
            <Button
              size="xs"
              variant="outline"
              disabled={!canChange}
              onClick={() => void run("on")}
            >
              Try again
            </Button>
          </div>
          {notAllowed}
          {problem}
        </>
      ) : (
        <>
          <Muted className={READING_MEASURE_CLASS}>
            Your phone can reach {computer.inSentence} from anywhere. Nothing to install on your
            phone.
          </Muted>
          <Steps>
            <OnPhoneSteps
              environmentId={environmentId}
              elsewhere={elsewhere}
              baseUrl={view.address}
              steps={steps}
            />
          </Steps>
          <Muted className={cn(READING_MEASURE_CLASS, "text-xs")}>
            {computer.atStart}'s address is{" "}
            <span className="break-all text-foreground">{view.address}</span>. It is on the
            internet, but {whoGetsIn()}.
            {hosted
              ? null
              : " The connection passes through Cloudflare, a company that could technically read it."}
          </Muted>
          {hosted ? null : (
            <div>
              <Button
                size="xs"
                variant="ghost-muted"
                disabled={!canChange || busy !== null}
                onClick={() => ask("off")}
              >
                {busy === "off" ? <Spinner size="sm" /> : null}
                Turn off this address
              </Button>
            </div>
          )}
          {problem}
        </>
      )}
      <AnywhereDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        change={asking}
        title={
          asking === "off"
            ? "Turn off this address?"
            : `Give ${computer.inSentence} an address on the internet?`
        }
        onConfirm={() => void run(asking)}
      />
    </div>
  );
}

/** Why nothing can be changed on another computer, and what gives this app the right to. */
function NotAllowed({ name }: { readonly name: string }) {
  const { inSentence } = phoneComputerWords(name);
  return (
    <Muted className={READING_MEASURE_CLASS}>
      This app is not allowed to change this on {inSentence}. Add {inSentence} again in{" "}
      <Link to="/settings/connections" className="underline underline-offset-2">
        Computers
      </Link>{" "}
      with a new code, then try again.
    </Muted>
  );
}

/** Asks before a computer's address on the internet is turned on or off. */
function AnywhereDialog({
  open,
  onOpenChange,
  change,
  title,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly change: "on" | "off";
  readonly title: string;
  readonly onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {change === "off"
              ? "Phones set up with this address stop working until you turn it on again. The address stays the same if you turn it on again within two weeks."
              : `Your phone uses this address to reach Majordome from anywhere. The address is on the internet, but ${whoGetsIn()}. The connection passes through Cloudflare, a company that could technically read it. You can turn it off at any time.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button variant={change === "off" ? "destructive" : "default"} onClick={onConfirm}>
            {change === "off" ? "Turn it off" : "Set it up"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

/** This computer's own address, when it is on while the phone is set up on another computer. */
function OwnAddress({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const result = useAtomValue(majordomeEnvironment.phoneSetup({ environmentId, input: {} }));
  const canChange = useAtomValue(
    majordomeEnvironment.disableAnywhereAddress.permissionAtom(environmentId),
  );
  const disable = useAtomCommand(majordomeEnvironment.disableAnywhereAddress, {
    reportFailure: false,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = AsyncResult.getOrElse(result, () => null)?.anywhere.state ?? "off";
  if (state === "off" && error === null) return null;

  const turnOff = async () => {
    setDialogOpen(false);
    setBusy(true);
    setError(null);
    const answer = await disable({ environmentId, input: {} });
    setBusy(false);
    if (answer._tag === "Success" || isAtomCommandInterrupted(answer)) return;
    const failure = squashAtomCommandFailure(answer);
    setError(failure instanceof Error ? failure.message : String(failure));
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      <Muted className={cn(READING_MEASURE_CLASS, "text-xs")}>
        This computer has its own address too. A phone set up with it only works while this computer
        is awake, and doesn't see your routines.
      </Muted>
      <div>
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={!canChange || busy || state === "off"}
          onClick={() => setDialogOpen(true)}
        >
          {busy ? <Spinner size="sm" /> : null}
          Turn off this computer's address
        </Button>
      </div>
      {error === null ? null : <p className="text-sm text-destructive-foreground">{error}</p>}
      <AnywhereDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        change="off"
        title="Turn off this computer's address?"
        onConfirm={() => void turnOff()}
      />
    </div>
  );
}

function SetupStep({
  title,
  done,
  children,
}: {
  readonly title: string;
  readonly done: boolean | PhoneStepState;
  readonly children: ReactNode;
}) {
  return (
    <Step
      title={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {title}
          {done === true || done === "done" ? (
            <Badge variant="success">Done</Badge>
          ) : done === "unseen" ? (
            <Badge variant="outline">Majordome can't check this step</Badge>
          ) : null}
        </span>
      }
    >
      {children}
    </Step>
  );
}

function SetupChecklist({
  environmentId,
  setup,
  steps,
  onCheckAgain,
  checking,
}: {
  readonly environmentId: EnvironmentId;
  readonly setup: MajordomePhoneSetup;
  readonly steps: PhoneSteps;
  readonly onCheckAgain: () => void;
  readonly checking: boolean;
}) {
  const { tailscaleOn, secureAddressesOn, majordomeReachable } = computerSetupProgress(
    setup.tailscale,
  );
  const checkAgain = (
    <div>
      <Button size="xs" variant="outline" disabled={checking} onClick={onCheckAgain}>
        {checking ? <Spinner size="sm" /> : null}
        Check again
      </Button>
    </div>
  );

  return (
    <Steps>
      <SetupStep title="Tailscale on this computer" done={tailscaleOn}>
        {tailscaleOn ? null : (
          <>
            {setup.tailscale === "not-installed" ? (
              <p>
                Install Tailscale on this computer from{" "}
                <ExternalLink href={TAILSCALE_DOWNLOAD_URL}>tailscale.com/download</ExternalLink>,
                open it and sign in. Making the account is free.
              </p>
            ) : (
              <p>Open Tailscale on this computer, sign in and make sure it is connected.</p>
            )}
            {checkAgain}
          </>
        )}
      </SetupStep>
      <SetupStep title="Secure addresses in Tailscale" done={secureAddressesOn}>
        {secureAddressesOn ? null : (
          <>
            <p>
              Open the{" "}
              <ExternalLink href={TAILSCALE_DNS_SETTINGS_URL}>DNS page of Tailscale</ExternalLink>{" "}
              and sign in. Turn on MagicDNS if it is off, then turn on HTTPS Certificates.
            </p>
            {tailscaleOn ? checkAgain : null}
          </>
        )}
      </SetupStep>
      <SetupStep title="Majordome's secure address" done={majordomeReachable}>
        {majordomeReachable ? (
          <p className={READING_MEASURE_CLASS}>
            Majordome is at{" "}
            <span className="font-medium break-all text-foreground">{setup.secureUrl}</span>. Only
            your devices signed in to your Tailscale account can open it.
          </p>
        ) : secureAddressesOn ? (
          <>
            <p className={READING_MEASURE_CLASS}>
              Majordome isn't on this computer's secure address yet
              {setup.secureUrl === null ? "" : ` (${setup.secureUrl})`}. Only your own devices
              signed in to your Tailscale account can open it.
            </p>
            <div className="flex flex-wrap gap-2">
              <EnableSecureAddressButton environmentId={environmentId} />
              {checkAgain}
            </div>
          </>
        ) : (
          <p>You turn it on here, with one button, once the steps above are done.</p>
        )}
      </SetupStep>
      <SetupStep title="Tailscale on your phone" done="unseen">
        <p>
          Install Tailscale on your phone from the App Store or Google Play, sign in with the same
          account and make sure it is connected.
        </p>
      </SetupStep>
      <OnPhoneSteps
        environmentId={environmentId}
        elsewhere={null}
        baseUrl={majordomeReachable ? setup.secureUrl : null}
        steps={steps}
      />
    </Steps>
  );
}

/** What happens on the phone itself, the same whichever address it opens. */
function OnPhoneSteps({
  environmentId,
  elsewhere,
  baseUrl,
  steps,
}: {
  readonly environmentId: EnvironmentId;
  readonly elsewhere: string | null;
  /** Null until the computer's side is done. */
  readonly baseUrl: string | null;
  readonly steps: PhoneSteps;
}) {
  return (
    <>
      <SetupStep title="Open Majordome on your phone" done={steps.open}>
        {baseUrl === null ? (
          <p>The code to scan with your phone's camera shows here once the steps above are done.</p>
        ) : (
          <>
            <p>Scan this code with your phone's camera and open the link.</p>
            <PairingCode environmentId={environmentId} elsewhere={elsewhere} baseUrl={baseUrl} />
          </>
        )}
      </SetupStep>
      <AfterOpeningSteps steps={steps} newCode="press “Show the code” here again" />
    </>
  );
}

/** The Home Screen and notifications, the same whichever way the phone first opened Majordome. */
function AfterOpeningSteps({
  steps,
  newCode,
}: {
  readonly steps: PhoneSteps;
  /** How to get a new code from this page, for a Home Screen app that asks for one. */
  readonly newCode: string;
}) {
  return (
    <>
      <SetupStep title="Add Majordome to your Home Screen" done={steps.homeScreen}>
        <p>
          On iPhone, tap Share, then “Add to Home Screen”. On Android, open Chrome's menu and tap
          “Add to Home screen” or “Install app”.
        </p>
        <p>
          Then open Majordome from your Home Screen. If it asks for a code, {newCode} and type the
          letters under the new one.
        </p>
      </SetupStep>
      <SetupStep title="Notifications on your phone" done={steps.notifications}>
        <p>
          In Majordome on your phone, open Settings, then “Phone & notifications”, and turn on
          “Notifications on this device”.
        </p>
      </SetupStep>
    </>
  );
}

function EnableSecureAddressButton({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const canEnable = useAtomValue(
    majordomeEnvironment.enableSecureAddress.permissionAtom(environmentId),
  );
  const enable = useAtomCommand(majordomeEnvironment.enableSecureAddress, {
    reportFailure: false,
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    const result = await enable({ environmentId, input: {} });
    setBusy(false);
    setOpen(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not turn on the secure address",
          description: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    toastManager.add({ type: "success", title: "Your phone can now reach Majordome" });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button size="xs" disabled={!canEnable} onClick={() => setOpen(true)}>
        Turn on secure address
      </Button>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Turn on the secure address?</AlertDialogTitle>
          <AlertDialogDescription>
            Tailscale will show Majordome at this computer's secure address, for your devices only.
            Each phone still needs a one-time code from this screen. It stays on until you turn it
            off in Tailscale.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
            Cancel
          </AlertDialogClose>
          <Button disabled={busy} onClick={() => void confirm()}>
            {busy && <Spinner size="sm" />}
            Turn it on
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

/** A one-time pairing link for `baseUrl` as a QR code. The code lives only in this component. */
function PairingCode({
  environmentId,
  elsewhere,
  baseUrl,
}: {
  readonly environmentId: EnvironmentId;
  readonly elsewhere: string | null;
  readonly baseUrl: string;
}) {
  const createPairingCredential = useAtomCommand(authEnvironment.createPairingCredential, {
    reportFailure: false,
  });
  const [code, setCode] = useState<{
    readonly url: string;
    readonly typed: string;
    readonly expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // What the code opens on the phone that scans it: Majordome in its browser, or the app.
  const [opens, setOpens] = useState<"browser" | "app">("browser");

  if (!readEnvironmentScope(environmentId, AuthAccessWriteScope)) {
    return elsewhere === null ? (
      <Muted>Open this screen on the computer where Majordome runs to get a code.</Muted>
    ) : (
      <NotAllowed name={elsewhere} />
    );
  }

  const show = async () => {
    setBusy(true);
    const result = await createPairingCredential({
      environmentId,
      input: {
        label: PHONE_PAIRING_LABEL,
        scopes: AuthStandardClientScopes.filter((scope) =>
          readEnvironmentScope(environmentId, scope),
        ),
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not make a code",
          description: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    setCode({
      url: resolveDesktopPairingUrl(baseUrl, result.value.credential),
      typed: result.value.credential,
      expiresAt: DateTime.formatIso(result.value.expiresAt),
    });
  };

  if (code === null) {
    return (
      <div className="mt-2">
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void show()}>
          {busy ? <Spinner size="sm" /> : null}
          Show the code
        </Button>
      </div>
    );
  }
  const appLink = phoneAppPairingLink(code.url);
  return (
    <div className="mt-2 flex flex-col gap-2">
      <ToggleGroup
        aria-label="Where the code opens Majordome"
        value={[opens]}
        onValueChange={(next) => {
          if (next[0] === "browser" || next[0] === "app") setOpens(next[0]);
        }}
      >
        <Toggle value="browser">In the browser</Toggle>
        <Toggle value="app">In the Majordome app</Toggle>
      </ToggleGroup>
      {/* White in both themes: a phone's camera reads dark squares on white. */}
      <Surface className="w-fit bg-white p-3">
        <QRCodeSvg
          value={opens === "app" ? appLink : code.url}
          size={168}
          level="M"
          marginSize={1}
          title="Code to open Majordome on your phone"
        />
      </Surface>
      {readIsOnPhone() ? (
        <div>
          <Button size="xs" variant="outline" render={<a href={appLink} />}>
            Open in the Majordome app
          </Button>
        </div>
      ) : null}
      <Muted className="text-xs">
        To type it instead: <span className="font-mono text-foreground">{code.typed}</span>
      </Muted>
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{formatExpiresInLabel(code.expiresAt)}. Works once.</span>
        <Button size="xs" variant="ghost-muted" onClick={() => setCode(null)}>
          Hide
        </Button>
      </div>
    </div>
  );
}
