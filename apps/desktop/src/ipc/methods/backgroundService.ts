import { DesktopBackgroundServiceStateSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as DesktopMajordService from "../../backend/DesktopMajordService.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getBackgroundServiceState = makeIpcMethod({
  channel: IpcChannels.BACKGROUND_SERVICE_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopBackgroundServiceStateSchema,
  handler: Effect.fn("desktop.ipc.backgroundService.getState")(function* () {
    return yield* (yield* DesktopMajordService.DesktopMajordService).state;
  }),
});

/**
 * The relaunched app picks its server by whether the service is installed: turning it on writes
 * the service from the running server's settings, turning it off removes it first.
 */
export const setBackgroundServiceEnabled = makeIpcMethod({
  channel: IpcChannels.BACKGROUND_SERVICE_SET_ENABLED_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.backgroundService.setEnabled")(function* (enabled) {
    const majord = yield* DesktopMajordService.DesktopMajordService;
    if (!majord.supported) {
      return yield* new DesktopMajordService.DesktopMajordServiceError({
        step: "checking this computer",
        cause: new Error("Only the Majordome app on a Mac can run in the background."),
      });
    }
    if ((yield* majord.state).enabled === enabled) return;
    if (enabled) {
      const primary = yield* (yield* DesktopBackendPool.DesktopBackendPool).primary;
      const config = yield* primary.currentConfig;
      if (Option.isNone(config)) {
        return yield* new DesktopMajordService.DesktopMajordServiceError({
          step: "reading the server's settings",
        });
      }
      yield* majord.ensure(config.value, { start: false });
    } else {
      yield* majord.uninstall;
    }
    yield* (yield* DesktopLifecycle.DesktopLifecycle).relaunch(`backgroundService=${enabled}`);
  }),
});

export const quitCompletely = makeIpcMethod({
  channel: IpcChannels.BACKGROUND_SERVICE_QUIT_COMPLETELY_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.backgroundService.quitCompletely")(function* () {
    yield* (yield* DesktopMajordService.DesktopMajordService).stop;
    yield* (yield* ElectronApp.ElectronApp).quit;
  }),
});
