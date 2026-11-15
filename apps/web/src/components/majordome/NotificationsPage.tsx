import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, MajordomePushDevice } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";
import { useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import {
  type DevicePush,
  NotificationsToggle,
  SUPPORT_COPY,
  useDevicePush,
} from "./NotificationsToggle";
import { readDevicePushSupport } from "./pushNotifications";

export function NotificationsPage() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  return (
    <MajordomeSettingsPage searchId="majordome-notifications">
      {environmentId === null ? null : <DeviceSections environmentId={environmentId} />}
      <Section title="What Majordome tells you about">
        <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-sm">
          <li>A run is waiting for you: it has a question or needs your OK.</li>
          <li>“Start my day” is ready, with its first line.</li>
          <li>A run couldn't finish, or ran past its time limit and was stopped.</li>
          <li>Routines paused for the rest of the day: they used today's runs.</li>
          <li>Something you asked an agent to tell you, like “let me know when it's done”.</li>
        </ul>
        <p className="text-sm text-muted-foreground">Nothing else.</p>
      </Section>
    </MajordomeSettingsPage>
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

function DeviceSections({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const [support] = useState(readDevicePushSupport);
  const push = useDevicePush(environmentId, support === "supported");
  return (
    <>
      {support === "supported" ? (
        <NotificationsToggle push={push} />
      ) : (
        <p className="text-sm text-muted-foreground">{SUPPORT_COPY[support]}</p>
      )}
      <Section title="Devices that get notifications">
        <DeviceList environmentId={environmentId} push={push} />
      </Section>
    </>
  );
}

function DeviceList({
  environmentId,
  push,
}: {
  readonly environmentId: EnvironmentId;
  readonly push: DevicePush;
}) {
  const result = useAtomValue(majordomeEnvironment.pushDevices({ environmentId, input: {} }));
  const devices = AsyncResult.getOrElse(result, () => null)?.devices ?? null;
  if (devices === null) {
    return result._tag === "Failure" ? (
      <p className="text-sm text-destructive-foreground">
        {formatEnvironmentQueryError(result.cause)}
      </p>
    ) : (
      <Skeleton className="h-10 w-full" />
    );
  }
  if (devices.length === 0) {
    return <p className="text-sm text-muted-foreground">No device gets notifications yet.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-lg border border-border p-0">
      {devices.map((device) => (
        <DeviceRow
          key={device.endpoint}
          environmentId={environmentId}
          device={device}
          push={push}
        />
      ))}
    </ul>
  );
}

function addedLabel(addedAt: string | null): string | null {
  if (addedAt === null) return null;
  const date = new Date(addedAt);
  return Number.isNaN(date.getTime())
    ? null
    : `Added ${date.toLocaleDateString(undefined, { dateStyle: "medium" })}`;
}

function DeviceRow({
  environmentId,
  device,
  push,
}: {
  readonly environmentId: EnvironmentId;
  readonly device: MajordomePushDevice;
  readonly push: DevicePush;
}) {
  const canRemove = useAtomValue(
    majordomeEnvironment.removePushSubscription.permissionAtom(environmentId),
  );
  const remove = useAtomCommand(majordomeEnvironment.removePushSubscription, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const isThisDevice = device.endpoint === push.endpoint;

  const onRemove = async () => {
    // Turning this device off also drops the browser's subscription, so the switch above follows.
    if (isThisDevice) return push.turnOff();
    setBusy(true);
    const result = await remove({ environmentId, input: { endpoint: device.endpoint } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not remove this device",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const added = addedLabel(device.addedAt);
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate">{device.label ?? "A device"}</span>
          {isThisDevice ? <Badge variant="secondary">This device</Badge> : null}
        </span>
        {added === null ? null : <span className="text-xs text-muted-foreground">{added}</span>}
      </div>
      <Button
        size="xs"
        variant="outline"
        disabled={!canRemove || busy || (isThisDevice && push.busy)}
        onClick={() => void onRemove()}
      >
        Remove
      </Button>
    </li>
  );
}
