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
import { Link } from "@tanstack/react-router";
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
import { Button } from "../ui/button";
import { QRCodeSvg } from "../ui/qr-code";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import { Muted, READING_MEASURE_CLASS, Section, StatusLine, Step, Steps, Surface } from "./paper";
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
    </MajordomeSettingsPage>
  );
}

function OnPhone() {
  return (
    <Section>
      <StatusLine tone="ok">You're on your phone</StatusLine>
      <Muted className="mt-2">
        Majordome is set up here. Choose what reaches this phone in{" "}
        <Link to="/settings/notifications" className="underline underline-offset-2">
          Notifications
        </Link>
        .
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

  return (
    <>
      <Section label="Use Majordome on your phone">
        {setup === null ? (
          result._tag === "Failure" ? (
            <p className="text-sm text-destructive-foreground">
              {formatEnvironmentQueryError(result.cause)}
            </p>
          ) : (
            <Skeleton className="h-24 w-full" />
          )
        ) : (
          <SecureAddressSteps
            environmentId={environmentId}
            setup={setup}
            onCheckAgain={checkAgain}
            checking={result.waiting}
          />
        )}
      </Section>
      {setup === null ? null : (
        <Section label="Same Wi-Fi only (no notifications)">
          {setup.wifiUrls.length > 0 ? (
            <>
              <Muted className={READING_MEASURE_CLASS}>
                When your phone is on the same Wi-Fi as this computer, it can open Majordome without
                Tailscale. Phones can't get notifications this way, and it stops working away from
                home.
              </Muted>
              <PairingCode environmentId={environmentId} baseUrl={setup.wifiUrls[0]!} />
            </>
          ) : (
            <Muted className={READING_MEASURE_CLASS}>
              This computer only accepts connections from itself right now, so Wi-Fi pairing is off.
              Use the secure address above instead.
            </Muted>
          )}
        </Section>
      )}
    </>
  );
}

function SecureAddressSteps({
  environmentId,
  setup,
  onCheckAgain,
  checking,
}: {
  readonly environmentId: EnvironmentId;
  readonly setup: MajordomePhoneSetup;
  readonly onCheckAgain: () => void;
  readonly checking: boolean;
}) {
  const checkAgain = (
    <Button size="xs" variant="outline" disabled={checking} onClick={onCheckAgain}>
      {checking ? <Spinner size="sm" /> : null}
      Check again
    </Button>
  );
  const intro = (
    <Muted className={READING_MEASURE_CLASS}>
      Your phone reaches Majordome through Tailscale, a free app that links your own devices
      privately. It gives this computer a secure address, which iPhone needs for notifications.
    </Muted>
  );

  switch (setup.tailscale) {
    case "not-installed":
      return (
        <>
          {intro}
          <Steps className="mt-3">
            <Step>
              Install Tailscale on this computer from{" "}
              <ExternalLink href={TAILSCALE_DOWNLOAD_URL}>tailscale.com/download</ExternalLink>,
              open it and sign in.
            </Step>
            <Step>
              Install Tailscale on your phone from the App Store or Google Play, and sign in with
              the same account.
            </Step>
            <Step>Come back here and check again.</Step>
          </Steps>
          <div className="mt-1">{checkAgain}</div>
        </>
      );
    case "signed-out":
      return (
        <>
          {intro}
          <Steps className="mt-3">
            <Step>Open Tailscale on this computer, sign in and make sure it is connected.</Step>
            <Step>Sign in to Tailscale on your phone with the same account.</Step>
            <Step>Come back here and check again.</Step>
          </Steps>
          <div className="mt-1">{checkAgain}</div>
        </>
      );
    case "https-off":
      return (
        <>
          <StatusLine tone="warning">
            Tailscale is on. One setting is missing: secure addresses for your devices.
          </StatusLine>
          <Steps className="mt-3">
            <Step>
              Open the{" "}
              <ExternalLink href={TAILSCALE_DNS_SETTINGS_URL}>DNS page of Tailscale</ExternalLink>{" "}
              and sign in.
            </Step>
            <Step>Turn on MagicDNS if it is off, then turn on HTTPS Certificates.</Step>
            <Step>Come back here and check again.</Step>
          </Steps>
          <div className="mt-1">{checkAgain}</div>
        </>
      );
    case "not-served":
      return (
        <>
          <StatusLine tone="warning" className={READING_MEASURE_CLASS}>
            Tailscale is ready. Majordome isn't on this computer's secure address yet
            {setup.secureUrl === null ? "" : ` (${setup.secureUrl})`}. Only your own devices signed
            in to your Tailscale account can open it.
          </StatusLine>
          <div className="mt-3 flex flex-wrap gap-2">
            <EnableSecureAddressButton environmentId={environmentId} />
            {checkAgain}
          </div>
        </>
      );
    case "ready":
      return (
        <>
          <StatusLine tone="ok" className={READING_MEASURE_CLASS}>
            Majordome is at <span className="font-medium break-all">{setup.secureUrl}</span>. Only
            your devices signed in to your Tailscale account can open it.
          </StatusLine>
          <Steps className="mt-3">
            <Step>On your phone, open Tailscale and make sure it is connected.</Step>
            <Step>
              Scan this code with your phone's camera and open the link.
              <PairingCode environmentId={environmentId} baseUrl={setup.secureUrl!} />
            </Step>
            <Step>
              Add Majordome to your Home Screen. On iPhone, tap Share, then “Add to Home Screen”. On
              Android, open Chrome's menu and tap “Add to Home screen” or “Install app”.
            </Step>
            <Step>
              Open Majordome from your Home Screen. If it asks for a code, press “Show the code”
              here again and type the letters under the new one.
            </Step>
            <Step>In Majordome on your phone, go to “Notifications” and turn them on.</Step>
          </Steps>
        </>
      );
  }
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
