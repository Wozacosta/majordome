import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { phoneSetupRevision } from "@t3tools/client-runtime/state/majordome";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthAccessWriteScope,
  AuthStandardClientScopes,
  type EnvironmentId,
  type MajordomePhoneSetup,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/utils";
import { authEnvironment } from "../../state/auth";
import { majordomeEnvironment } from "../../state/majordome";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { formatEnvironmentQueryError } from "../../state/query";
import { readEnvironmentScope } from "../../state/session";
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
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import { NotificationsSections } from "./NotificationsSections";
import {
  Disclosure,
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
  phoneWays,
  phoneWithNotifications,
} from "./phone.logic";
import { readIsOnPhone } from "./pushNotifications";

const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
const TAILSCALE_DNS_SETTINGS_URL = "https://login.tailscale.com/admin/dns";
const ANYWHERE_RECHECK_MS = 3000;

export function PhonePage() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const [onPhone] = useState(readIsOnPhone);
  return (
    <MajordomeSettingsPage searchId="majordome-phone">
      {onPhone ? (
        <OnPhone />
      ) : environmentId === null ? null : (
        <PhoneSetupSection environmentId={environmentId} />
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

function PhoneSetupSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const result = useAtomValue(majordomeEnvironment.phoneSetup({ environmentId, input: {} }));
  const bumpRevision = useAtomSet(phoneSetupRevision(environmentId));
  const checkAgain = () => bumpRevision((value) => value + 1);
  const setup = AsyncResult.getOrElse(result, () => null);
  const devices = useAtomValue(majordomeEnvironment.pushDevices({ environmentId, input: {} }));
  const phone = phoneWithNotifications(AsyncResult.getOrElse(devices, () => null)?.devices ?? []);

  const connecting = setup?.anywhere.state === "starting";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A real timer: while the computer is still connecting its address, only asking it again shows when the address is ready.
  useEffect(() => {
    if (!connecting) return;
    const timer = setInterval(() => bumpRevision((value) => value + 1), ANYWHERE_RECHECK_MS);
    return () => clearInterval(timer);
  }, [connecting, bumpRevision]);

  return (
    <Section label="Set up your phone">
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
      ) : (
        <PhoneWays
          environmentId={environmentId}
          setup={setup}
          phoneDone={phone !== null}
          onCheckAgain={checkAgain}
          checking={result.waiting}
        />
      )}
    </Section>
  );
}

function PhoneWays({
  environmentId,
  setup,
  phoneDone,
  onCheckAgain,
  checking,
}: {
  readonly environmentId: EnvironmentId;
  readonly setup: MajordomePhoneSetup;
  readonly phoneDone: boolean;
  readonly onCheckAgain: () => void;
  readonly checking: boolean;
}) {
  const ways = phoneWays(setup);
  return (
    <>
      <AnywhereAddress
        environmentId={environmentId}
        anywhere={setup.anywhere}
        suggested={ways.suggested === "anywhere"}
        phoneDone={phoneDone}
        checking={checking}
      />
      <Disclosure
        className="mt-4"
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
          phoneDone={phoneDone}
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
            <PairingCode environmentId={environmentId} baseUrl={setup.wifiUrls[0]!} />
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

type Anywhere = MajordomePhoneSetup["anywhere"];

/** The main way: an address on the internet that a phone opens with nothing installed. */
function AnywhereAddress({
  environmentId,
  anywhere: read,
  suggested,
  phoneDone,
  checking,
}: {
  readonly environmentId: EnvironmentId;
  readonly anywhere: Anywhere;
  /** False when Tailscale is the way to follow, so this one does not push. */
  readonly suggested: boolean;
  readonly phoneDone: boolean;
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
  const problem =
    error === null ? null : <p className="text-sm text-destructive-foreground">{error}</p>;

  return (
    <div className="flex flex-col gap-3">
      {view.kind === "offer" ? (
        <>
          <Muted className={READING_MEASURE_CLASS}>
            {suggested
              ? "Majordome gives this computer its own address, and your phone opens it by scanning a code. Nothing to install on your phone, and no account to make."
              : "Your phone already reaches this computer through Tailscale, and you don't need to change anything. Majordome can also give this computer its own address, for a phone without Tailscale."}
          </Muted>
          <div>
            <Button
              variant={suggested ? "default" : "outline"}
              disabled={!canChange}
              onClick={() => ask("on")}
            >
              {suggested ? "Set up my phone" : "Get an address"}
            </Button>
          </div>
          {problem}
        </>
      ) : view.kind === "starting" ? (
        <StatusLine tone="neutral" className={READING_MEASURE_CLASS} aria-live="polite">
          Getting your address… This can take up to half a minute.
        </StatusLine>
      ) : view.kind === "unavailable" ? (
        <>
          <StatusLine tone="warning" className={READING_MEASURE_CLASS}>
            {view.reason ?? "This computer can't get an address right now."}
          </StatusLine>
          <Muted className={READING_MEASURE_CLASS}>
            You can still set up your phone with Tailscale, in the steps below.
          </Muted>
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
          {problem}
        </>
      ) : (
        <>
          <Muted className={READING_MEASURE_CLASS}>
            Your phone can reach this computer from anywhere. Nothing to install on your phone.
          </Muted>
          <Steps>
            <OnPhoneSteps
              environmentId={environmentId}
              baseUrl={view.address}
              phoneDone={phoneDone}
            />
          </Steps>
          <Muted className={cn(READING_MEASURE_CLASS, "text-xs")}>
            This computer's address is{" "}
            <span className="break-all text-foreground">{view.address}</span>. It is on the
            internet, but only devices you add with a code from this screen can get in. The
            connection passes through Cloudflare, a company that could technically read it.
          </Muted>
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
          {problem}
        </>
      )}
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {asking === "off"
                ? "Turn off this address?"
                : "Give this computer an address on the internet?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {asking === "off"
                ? "Phones set up with this address stop working until you turn it on again. The address stays the same if you turn it on again within two weeks."
                : "Your phone uses this address to reach Majordome from anywhere. The address is on the internet, but only devices you add with a code from this screen can get in. The connection passes through Cloudflare, a company that could technically read it. You can turn it off at any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant={asking === "off" ? "destructive" : "default"}
              onClick={() => void run(asking)}
            >
              {asking === "off" ? "Turn it off" : "Set it up"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

function SetupStep({
  title,
  done,
  children,
}: {
  readonly title: string;
  readonly done: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Step
      title={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {title}
          {done ? <Badge variant="success">Done</Badge> : null}
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
  phoneDone,
  onCheckAgain,
  checking,
}: {
  readonly environmentId: EnvironmentId;
  readonly setup: MajordomePhoneSetup;
  readonly phoneDone: boolean;
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
      <SetupStep title="Tailscale on your phone" done={phoneDone}>
        <p>
          Install Tailscale on your phone from the App Store or Google Play, sign in with the same
          account and make sure it is connected.
        </p>
      </SetupStep>
      <OnPhoneSteps
        environmentId={environmentId}
        baseUrl={majordomeReachable ? setup.secureUrl : null}
        phoneDone={phoneDone}
      />
    </Steps>
  );
}

/** What happens on the phone itself, the same whichever address it opens. */
function OnPhoneSteps({
  environmentId,
  baseUrl,
  phoneDone,
}: {
  readonly environmentId: EnvironmentId;
  /** Null until the computer's side is done. */
  readonly baseUrl: string | null;
  readonly phoneDone: boolean;
}) {
  return (
    <>
      <SetupStep title="Open Majordome on your phone" done={phoneDone}>
        {baseUrl === null ? (
          <p>The code to scan with your phone's camera shows here once the steps above are done.</p>
        ) : (
          <>
            <p>Scan this code with your phone's camera and open the link.</p>
            <PairingCode environmentId={environmentId} baseUrl={baseUrl} />
          </>
        )}
      </SetupStep>
      <SetupStep title="Add Majordome to your Home Screen" done={phoneDone}>
        <p>
          On iPhone, tap Share, then “Add to Home Screen”. On Android, open Chrome's menu and tap
          “Add to Home screen” or “Install app”.
        </p>
        <p>
          Then open Majordome from your Home Screen. If it asks for a code, press “Show the code”
          here again and type the letters under the new one.
        </p>
      </SetupStep>
      <SetupStep title="Notifications on your phone" done={phoneDone}>
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
  baseUrl,
}: {
  readonly environmentId: EnvironmentId;
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

  if (!readEnvironmentScope(environmentId, AuthAccessWriteScope)) {
    return <Muted>Open this screen on the computer where Majordome runs to get a code.</Muted>;
  }

  const show = async () => {
    setBusy(true);
    const result = await createPairingCredential({
      environmentId,
      input: {
        label: "Phone",
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
  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* White in both themes: a phone's camera reads dark squares on white. */}
      <Surface className="w-fit bg-white p-3">
        <QRCodeSvg
          value={code.url}
          size={168}
          level="M"
          marginSize={1}
          title="Code to open Majordome on your phone"
        />
      </Surface>
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
