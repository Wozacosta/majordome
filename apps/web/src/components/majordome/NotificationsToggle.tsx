import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { BellIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import type { DevicePushSupport } from "./phone.logic";
import {
  readDevicePushSupport,
  readDeviceSubscription,
  subscribeDevice,
  unsubscribeDevice,
} from "./pushNotifications";

const SUPPORT_COPY: Record<Exclude<DevicePushSupport, "supported">, string> = {
  insecure:
    "Notifications need the secure address. Open Majordome from the link on the “Your phone” screen.",
  "needs-home-screen":
    "On iPhone and iPad, add Majordome to your Home Screen first, then open it from there.",
  unsupported: "This browser can't show Majordome's notifications.",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * "Notifications on this device": a waiting run, "Start my day", and a run that couldn't finish.
 * `compact` is the one-line version for the Feed, shown only where notifications can work.
 */
export function NotificationsToggle({ compact = false }: { readonly compact?: boolean }) {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const [support] = useState(readDevicePushSupport);
  if (environmentId === null) return null;
  if (support !== "supported") {
    return compact ? null : (
      <p className="text-sm text-muted-foreground">{SUPPORT_COPY[support]}</p>
    );
  }
  return <SupportedNotificationsToggle environmentId={environmentId} compact={compact} />;
}

function SupportedNotificationsToggle({
  environmentId,
  compact,
}: {
  readonly environmentId: EnvironmentId;
  readonly compact: boolean;
}) {
  const canSave = useAtomValue(
    majordomeEnvironment.savePushSubscription.permissionAtom(environmentId),
  );
  const pushConfig = useAtomValue(majordomeEnvironment.pushConfig({ environmentId, input: {} }));
  const publicKey = AsyncResult.getOrElse(pushConfig, () => null)?.publicKey ?? null;
  const save = useAtomCommand(majordomeEnvironment.savePushSubscription, { reportFailure: false });
  const remove = useAtomCommand(majordomeEnvironment.removePushSubscription, {
    reportFailure: false,
  });
  const sendTest = useAtomCommand(majordomeEnvironment.sendTestPush, { reportFailure: false });
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reads the browser's push subscription, which lives outside React.
  useEffect(() => {
    let cancelled = false;
    void readDeviceSubscription()
      .then((subscription) => {
        if (!cancelled) setEndpoint(subscription?.endpoint ?? null);
      })
      .catch(() => {
        if (!cancelled) setEndpoint(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fail = (title: string, error: unknown) =>
    toastManager.add({ type: "error", title, description: errorMessage(error) });

  const turnOn = async () => {
    if (publicKey === null) return;
    setBusy(true);
    try {
      const subscription = await subscribeDevice(publicKey);
      const result = await save({ environmentId, input: { subscription } });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          fail("Could not turn on notifications", squashAtomCommandFailure(result));
        }
        return;
      }
      setEndpoint(subscription.endpoint);
    } catch (error) {
      fail("Could not turn on notifications", error);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      const removed = await unsubscribeDevice();
      if (removed !== null) await remove({ environmentId, input: { endpoint: removed } });
      setEndpoint(null);
    } catch (error) {
      fail("Could not turn off notifications", error);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (endpoint == null) return;
    const result = await sendTest({ environmentId, input: { endpoint } });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        fail("The test notification didn't go out", squashAtomCommandFailure(result));
      }
      return;
    }
    toastManager.add({ type: "success", title: "Test sent. It should show up in a moment." });
  };

  const on = endpoint != null;
  const toggle = (
    <label className="flex items-center gap-2 text-sm">
      <Switch
        size="sm"
        checked={on}
        disabled={busy || !canSave || endpoint === undefined || (!on && publicKey === null)}
        onCheckedChange={(checked) => void (checked ? turnOn() : turnOff())}
      />
      Notifications on this device
      {busy ? <Spinner size="sm" /> : null}
    </label>
  );

  if (compact) {
    return (
      <div className="flex min-h-7 items-center gap-2 px-3 text-xs text-muted-foreground">
        <BellIcon className="size-3.5 shrink-0" aria-hidden />
        {toggle}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {toggle}
        {on ? (
          <Button size="xs" variant="outline" onClick={() => void test()}>
            Send a test
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        You'll hear from Majordome when a run is waiting for you, when “Start my day” is ready, and
        when a run couldn't finish. Nothing else.
      </p>
      {canSave ? null : (
        <p className="text-sm text-muted-foreground">
          This device was paired without permission to run things, so it can't turn this on.
        </p>
      )}
    </div>
  );
}
