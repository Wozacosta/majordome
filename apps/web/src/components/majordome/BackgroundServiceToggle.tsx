import type { DesktopBackgroundServiceState } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Muted, READING_MEASURE_CLASS, Section, SwitchLabel } from "./paper";

const backgroundServiceBridge = () =>
  typeof window === "undefined" ? undefined : window.desktopBridge?.backgroundService;

/** Marks the switch busy around `work`. Kept outside hooks: React Compiler can't compile `finally`. */
async function whileBusy(setBusy: (busy: boolean) => void, work: () => Promise<void>) {
  setBusy(true);
  try {
    await work();
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Majordome couldn't change this",
      description: error instanceof Error ? error.message : String(error),
    });
  } finally {
    setBusy(false);
  }
}

/** The Mac app's `majord` service; null in a browser, on the phone, or until the app answers. */
export function useBackgroundService(): DesktopBackgroundServiceState | null {
  const [state, setState] = useState<DesktopBackgroundServiceState | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reads the desktop app's launch agent, which lives outside React.
  useEffect(() => {
    const bridge = backgroundServiceBridge();
    if (bridge === undefined) return;
    let cancelled = false;
    void bridge
      .getState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/**
 * "Keep Majordome running when the window is closed". Switching relaunches the app, which then
 * runs its own server or connects to the service.
 */
export function BackgroundServiceToggle({
  state,
}: {
  readonly state: DesktopBackgroundServiceState | null;
}) {
  const [busy, setBusy] = useState(false);
  const bridge = backgroundServiceBridge();
  if (bridge === undefined || state === null || !state.supported) return null;

  return (
    <Section label="In the background" aria-label="In the background">
      <div className="flex flex-wrap items-center gap-x-3">
        <SwitchLabel>
          <Switch
            checked={state.enabled}
            disabled={busy}
            onCheckedChange={(checked) => void whileBusy(setBusy, () => bridge.setEnabled(checked))}
          />
          Keep Majordome running when the window is closed
          {busy ? <Spinner size="sm" /> : null}
        </SwitchLabel>
        {state.enabled ? (
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => void whileBusy(setBusy, () => bridge.quitCompletely())}
          >
            Quit Majordome completely
          </Button>
        ) : null}
      </div>
      <Muted className={READING_MEASURE_CLASS}>
        {state.enabled
          ? "Routines and your inbox keep working after you close the window, and Majordome starts when you log in. Quitting completely stops it until you open Majordome again."
          : "Routines and your inbox only work while Majordome is open."}{" "}
        Majordome restarts when you change this.
      </Muted>
    </Section>
  );
}
