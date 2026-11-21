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
import { useState } from "react";

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
import { computerSetupProgress, NOTIFICATIONS_ANCHOR, phoneWithNotifications } from "./phone.logic";
import { readIsOnPhone } from "./pushNotifications";

const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
const TAILSCALE_DNS_SETTINGS_URL = "https://login.tailscale.com/admin/dns";

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

  return (
    <Section label="Set up your phone">
      {phone === null ? (
        <Muted className={READING_MEASURE_CLASS}>
          About 10 minutes, and you need a free Tailscale account. Tailscale is an app that links
          your own devices privately. It gives this computer a secure address, which iPhone needs
          for notifications.
        </Muted>
      ) : (
        <StatusLine tone="ok" className={READING_MEASURE_CLASS}>
          Your phone is set up: {phone} gets notifications. Follow the steps again to add another
          phone.
        </StatusLine>
      )}
      {setup === null ? (
        result._tag === "Failure" ? (
          <p className="mt-3 text-sm text-destructive-foreground">
            {formatEnvironmentQueryError(result.cause)}
          </p>
        ) : (
          <Skeleton className="mt-3 h-24 w-full" />
        )
      ) : (
        <>
          <SetupChecklist
            environmentId={environmentId}
            setup={setup}
            phoneDone={phone !== null}
            onCheckAgain={checkAgain}
            checking={result.waiting}
          />
          <Disclosure summary="On the same Wi-Fi only, without notifications">
            {setup.wifiUrls.length > 0 ? (
              <>
                <Muted className={READING_MEASURE_CLASS}>
                  When your phone is on the same Wi-Fi as this computer, it can open Majordome
                  without Tailscale. Phones can't get notifications this way, and it stops working
                  away from home.
                </Muted>
                <PairingCode environmentId={environmentId} baseUrl={setup.wifiUrls[0]!} />
              </>
            ) : (
              <Muted className={READING_MEASURE_CLASS}>
                This computer only accepts connections from itself right now, so Wi-Fi pairing is
                off. Use the steps above instead.
              </Muted>
            )}
          </Disclosure>
        </>
      )}
    </Section>
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
    <Steps className="mt-3">
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
      <SetupStep title="Open Majordome on your phone" done={phoneDone}>
        {majordomeReachable ? (
          <>
            <p>Scan this code with your phone's camera and open the link.</p>
            <PairingCode environmentId={environmentId} baseUrl={setup.secureUrl!} />
          </>
        ) : (
          <p>The code to scan with your phone's camera shows here once the steps above are done.</p>
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
    </Steps>
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
