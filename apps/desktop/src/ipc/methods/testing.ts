import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopNewOwnerCopy from "../../app/DesktopNewOwnerCopy.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const openNewOwnerCopy = makeIpcMethod({
  channel: IpcChannels.TESTING_OPEN_NEW_OWNER_COPY_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.testing.openNewOwnerCopy")(function* () {
    yield* DesktopNewOwnerCopy.open();
  }),
});
