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

import { isElectron } from "../../env";
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
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { NotificationsToggle } from "./NotificationsToggle";

const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
const TAILSCALE_DNS_SETTINGS_URL = "https://login.tailscale.com/admin/dns";

export function PhonePage() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Your phone</h1>
        </WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer>
            <Section title="Notifications on this device">
              <NotificationsToggle />
            </Section>
            {environmentId === null ? null : <PhoneSetupSection environmentId={environmentId} />}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Steps({ children }: { readonly children: ReactNode }) {
  return <ol className="m-0 flex list-decimal flex-col gap-2 ps-5 text-sm">{children}</ol>;
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
      <Section title="Use Majordome on your phone">
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
        <Section title="Same Wi-Fi only (no notifications)">
          {setup.wifiUrls.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                When your phone is on the same Wi-Fi as this computer, it can open Majordome without
                Tailscale. Phones can't get notifications this way, and it stops working away from
                home.
              </p>
              <PairingCode environmentId={environmentId} baseUrl={setup.wifiUrls[0]!} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              This computer only accepts connections from itself right now, so Wi-Fi pairing is off.
              Use the secure address above instead.
            </p>
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
    <Button
      size="xs"
      variant="outline"
      className="w-fit"
      disabled={checking}
      onClick={onCheckAgain}
    >
      {checking ? <Spinner size="sm" /> : null}
      Check again
    </Button>
  );
  const intro = (
    <p className="text-sm text-muted-foreground">
      Your phone reaches Majordome through Tailscale, a free app that links your own devices
      privately. It gives this computer a secure address, which iPhone needs for notifications.
    </p>
  );

  switch (setup.tailscale) {
    case "not-installed":
      return (
        <>
          {intro}
          <Steps>
            <li>
              Install Tailscale on this computer from{" "}
              <ExternalLink href={TAILSCALE_DOWNLOAD_URL}>tailscale.com/download</ExternalLink>,
              open it and sign in.
            </li>
            <li>
              Install Tailscale on your phone from the App Store or Google Play, and sign in with
              the same account.
            </li>
            <li>Come back here and check again.</li>
          </Steps>
          {checkAgain}
        </>
      );
    case "signed-out":
      return (
        <>
          {intro}
          <Steps>
            <li>Open Tailscale on this computer, sign in and make sure it is connected.</li>
            <li>Sign in to Tailscale on your phone with the same account.</li>
            <li>Come back here and check again.</li>
          </Steps>
          {checkAgain}
        </>
      );
    case "https-off":
      return (
        <>
          <p className="text-sm text-muted-foreground">
            Tailscale is on. One setting is missing: secure addresses for your devices.
          </p>
          <Steps>
            <li>
              Open the{" "}
              <ExternalLink href={TAILSCALE_DNS_SETTINGS_URL}>DNS page of Tailscale</ExternalLink>{" "}
              and sign in.
            </li>
            <li>Turn on MagicDNS if it is off, then turn on HTTPS Certificates.</li>
            <li>Come back here and check again.</li>
          </Steps>
          {checkAgain}
        </>
      );
    case "not-served":
      return (
        <>
          <p className="text-sm text-muted-foreground">
            Tailscale is ready. Majordome isn't on this computer's secure address yet
            {setup.secureUrl === null ? "" : ` (${setup.secureUrl})`}. Only your own devices signed
            in to your Tailscale account can open it.
          </p>
          <div className="flex flex-wrap gap-2">
            <EnableSecureAddressButton environmentId={environmentId} />
            {checkAgain}
          </div>
        </>
      );
    case "ready":
      return (
        <>
          <p className="text-sm text-muted-foreground">
            Majordome is at <span className="font-medium text-foreground">{setup.secureUrl}</span>.
            Only your devices signed in to your Tailscale account can open it.
          </p>
          <Steps>
            <li>On your phone, open Tailscale and make sure it is connected.</li>
            <li>
              Scan this code with your phone's camera and open the link.
              <PairingCode environmentId={environmentId} baseUrl={setup.secureUrl!} />
            </li>
            <li>
              Add Majordome to your Home Screen. On iPhone, tap Share, then “Add to Home Screen”. On
              Android, open Chrome's menu and tap “Add to Home screen” or “Install app”.
            </li>
            <li>
              Open Majordome from your Home Screen, go to “Your phone” and turn on notifications.
            </li>
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
  const [code, setCode] = useState<{ readonly url: string; readonly expiresAt: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  if (!readEnvironmentScope(environmentId, AuthAccessWriteScope)) {
    return (
      <p className="text-sm text-muted-foreground">
        Open this screen on the computer where Majordome runs to get a code.
      </p>
    );
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
      <div className="w-fit rounded-xl bg-white p-3">
        <QRCodeSvg
          value={code.url}
          size={168}
          level="M"
          marginSize={1}
          title="Code to open Majordome on your phone"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {formatExpiresInLabel(code.expiresAt)}. Works once.{" "}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => setCode(null)}
        >
          Hide
        </button>
      </p>
    </div>
  );
}
