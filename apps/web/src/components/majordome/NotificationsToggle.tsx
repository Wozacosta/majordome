import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Muted, SwitchLabel } from "./paper";
import type { DevicePushSupport } from "./phone.logic";
import {
  readDeviceLabel,
  readDeviceSubscription,
  subscribeDevice,
  unsubscribeDevice,
} from "./pushNotifications";

export const SUPPORT_COPY: Record<Exclude<DevicePushSupport, "supported">, string> = {
  insecure:
    "Notifications need the secure address. Open Majordome from the link on the “Phone & notifications” screen.",
  "needs-home-screen":
    "On iPhone and iPad, add Majordome to your Home Screen first, then open it from there.",
  unsupported: "This browser can't show Majordome's notifications.",
};

/** Marks the switch busy around `work`. Kept outside hooks: React Compiler can't compile `finally`. */
async function whileBusy(setBusy: (busy: boolean) => void, work: () => Promise<void>) {
  setBusy(true);
  try {
    await work();
  } finally {
    setBusy(false);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const fail = (title: string, error: unknown) =>
  toastManager.add({ type: "error", title, description: errorMessage(error) });

/**
 * This device's notifications: its subscription (`undefined` while it is read, `null` when off)
 * and the actions that change it. Where the browser can't get notifications, it stays off.
 */
export function useDevicePush(environmentId: EnvironmentId, supported: boolean) {
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
  const [endpoint, setEndpoint] = useState<string | null | undefined>(supported ? undefined : null);
  const [busy, setBusy] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reads the browser's push subscription, which lives outside React.
  useEffect(() => {
    if (!supported) return;
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
  }, [supported]);

  const turnOn = async () => {
    if (publicKey === null) return;
    await whileBusy(setBusy, async () => {
      try {
        const subscription = await subscribeDevice(publicKey);
        const label = readDeviceLabel();
        const result = await save({
          environmentId,
          input: { subscription, ...(label === undefined ? {} : { label }) },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            fail("Could not turn on notifications", squashAtomCommandFailure(result));
          }
          return;
        }
        setEndpoint(subscription.endpoint);
      } catch (error) {
        fail("Could not turn on notifications", error);
      }
    });
  };

  const turnOff = async () => {
    await whileBusy(setBusy, async () => {
      try {
        const removed = await unsubscribeDevice();
        if (removed !== null) await remove({ environmentId, input: { endpoint: removed } });
        setEndpoint(null);
      } catch (error) {
        fail("Could not turn off notifications", error);
      }
    });
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

  return { endpoint, busy, canSave, ready: publicKey !== null, turnOn, turnOff, test };
}

export type DevicePush = ReturnType<typeof useDevicePush>;

/** "Notifications on this device", with "Send a test" once they are on. */
export function NotificationsToggle({ push }: { readonly push: DevicePush }) {
  const on = push.endpoint != null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3">
        <SwitchLabel>
          <Switch
            checked={on}
            disabled={
              push.busy || !push.canSave || push.endpoint === undefined || (!on && !push.ready)
            }
            onCheckedChange={(checked) => void (checked ? push.turnOn() : push.turnOff())}
          />
          Notifications on this device
          {push.busy ? <Spinner size="sm" /> : null}
        </SwitchLabel>
        {on ? (
          <Button size="xs" variant="outline" onClick={() => void push.test()}>
            Send a test
          </Button>
        ) : null}
      </div>
      {push.canSave ? null : (
        <Muted>
          This device was paired without permission to run things, so it can't turn this on.
        </Muted>
      )}
    </div>
  );
}
