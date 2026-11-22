import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, MajordomePushDevice } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import {
  type DevicePush,
  NotificationsToggle,
  SUPPORT_COPY,
  useDevicePush,
} from "./NotificationsToggle";
import { Entry, EntryList, Muted, Section } from "./paper";
import { phoneComputerWords } from "./phone.logic";
import { readDevicePushSupport, readIsOnPhone } from "./pushNotifications";
import { type PhoneEnvironment, usePhoneEnvironment } from "./usePhoneEnvironment";

const WHAT_IT_TELLS_YOU = [
  "The assistant is waiting for you: it has a question or needs your OK.",
  "“Start my day” is ready, with its first line.",
  "The assistant couldn't finish, or a routine ran past its time limit and was stopped.",
  "Routines paused for the rest of the day: they reached today's limit.",
  "Something you asked the assistant to tell you, like “let me know when it's done”.",
];

/** The notifications part of "Phone & notifications": this device, every device, what is sent. */
export function NotificationsSections() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const target = usePhoneEnvironment();
  // A phone lists the computer it is open on: that is where its own switch subscribes.
  const [onPhone] = useState(readIsOnPhone);
  const elsewhere = onPhone || target === null || target.isThisComputer ? null : target;
  return (
    <>
      {environmentId === null ? null : (
        <DeviceSections environmentId={environmentId} elsewhere={elsewhere} />
      )}
      <Section label="What Majordome tells you about">
        <EntryList>
          {WHAT_IT_TELLS_YOU.map((line) => (
            <Entry key={line}>{line}</Entry>
          ))}
          <Entry>
            <Muted>Nothing else.</Muted>
          </Entry>
        </EntryList>
      </Section>
    </>
  );
}

function DeviceSections({
  environmentId,
  elsewhere,
}: {
  readonly environmentId: EnvironmentId;
  /** The computer a phone is set up on, when it is another one: phones subscribe there. */
  readonly elsewhere: PhoneEnvironment | null;
}) {
  const [support] = useState(readDevicePushSupport);
  const push = useDevicePush(environmentId, support === "supported");
  return (
    <>
      <Section label="Notifications on this device">
        {support === "supported" ? (
          <NotificationsToggle push={push} />
        ) : (
          <Muted>{SUPPORT_COPY[support]}</Muted>
        )}
      </Section>
      <Section
        label={
          elsewhere === null
            ? "Devices that get notifications"
            : `Devices that get notifications from ${phoneComputerWords(elsewhere.name).inSentence}`
        }
      >
        <DeviceList environmentId={elsewhere?.environmentId ?? environmentId} push={push} />
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
    return <Muted>No device gets notifications yet.</Muted>;
  }
  return (
    <EntryList>
      {devices.map((device) => (
        <DeviceRow
          key={device.endpoint}
          environmentId={environmentId}
          device={device}
          push={push}
        />
      ))}
    </EntryList>
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

  return (
    <Entry
      title={device.label ?? "A device"}
      aside={isThisDevice ? <Badge variant="secondary">This device</Badge> : null}
      meta={addedLabel(device.addedAt)}
      actions={
        <Button
          size="xs"
          variant="outline"
          disabled={!canRemove || busy || (isThisDevice && push.busy)}
          onClick={() => void onRemove()}
        >
          Remove
        </Button>
      }
    />
  );
}
