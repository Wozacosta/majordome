import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { CloudIcon, LaptopIcon, ServerIcon, SmartphoneIcon } from "lucide-react";

import { majordomeEnvironment } from "../../state/majordome";
import { FlowDiagram } from "./FlowDiagram";
import { phoneWithNotifications } from "./phone.logic";
import type { ServerRow } from "./servers.logic";
import {
  serversMap,
  type ServersMap as ServersMapModel,
  type ServersMapNode,
} from "./serversMap.logic";
import { useMachineNames } from "./useMachineNames";
import { useAssistantEnvironmentId } from "./useMajordomeVaults";
import { type PhoneEnvironment, usePhoneEnvironment } from "./usePhoneEnvironment";

const NODE_ICONS = {
  "this-device": LaptopIcon,
  phone: SmartphoneIcon,
  server: ServerIcon,
  hosted: CloudIcon,
} as const;

/**
 * A drawing of what opens what: this device and the phone on the left, the servers on the right,
 * and the main one marked. The list under it says the same in words, with the actions.
 */
export function ServersMap({
  servers,
  serversOpenTheirPage = false,
}: {
  readonly servers: ReadonlyArray<ServerRow>;
  /** Away from Your servers, a server's box opens that page. */
  readonly serversOpenTheirPage?: boolean;
}) {
  const phone = usePhoneEnvironment();
  return phone === null ? (
    <Drawing servers={servers} phone={null} serversOpenTheirPage={serversOpenTheirPage} />
  ) : (
    <WithPhone servers={servers} phone={phone} serversOpenTheirPage={serversOpenTheirPage} />
  );
}

function WithPhone({
  servers,
  phone,
  serversOpenTheirPage,
}: {
  readonly servers: ReadonlyArray<ServerRow>;
  readonly phone: PhoneEnvironment;
  readonly serversOpenTheirPage: boolean;
}) {
  const devices = useAtomValue(
    majordomeEnvironment.pushDevices({ environmentId: phone.environmentId, input: {} }),
  );
  // A computer that cannot say leaves the phone off the drawing, not "not set up".
  const known = AsyncResult.getOrElse(devices, () => null);
  return (
    <Drawing
      servers={servers}
      serversOpenTheirPage={serversOpenTheirPage}
      phone={
        known === null
          ? null
          : {
              environmentId: phone.environmentId,
              computerName: phone.name,
              deviceName: phoneWithNotifications(known.devices),
            }
      }
    />
  );
}

function Drawing({
  servers,
  phone,
  serversOpenTheirPage,
}: {
  readonly servers: ReadonlyArray<ServerRow>;
  readonly serversOpenTheirPage: boolean;
  readonly phone: {
    readonly environmentId: EnvironmentId;
    readonly computerName: string;
    readonly deviceName: string | null;
  } | null;
}) {
  const { localEnvironmentId, machineOf } = useMachineNames();
  const mainId = useAssistantEnvironmentId();
  const map: ServersMapModel = serversMap({
    thisDevice:
      localEnvironmentId === null
        ? { name: "This browser", environmentId: null }
        : { name: machineOf(localEnvironmentId), environmentId: localEnvironmentId },
    servers,
    mainId,
    phone,
  });
  const node = (item: ServersMapNode) => ({
    id: item.id,
    icon: NODE_ICONS[item.kind],
    title: item.title,
    detail: item.detail,
    faint: item.faint,
    ...(item.main ? { badge: "Main" } : {}),
    // The phone is set up, and changed, on its own settings page.
    ...(item.kind === "phone" ? { to: "/settings/phone" as const } : {}),
    ...(serversOpenTheirPage && (item.kind === "server" || item.kind === "hosted")
      ? { to: "/settings/always-on" as const }
      : {}),
  });
  return (
    <div className="mb-4 hidden sm:block">
      <FlowDiagram
        columns={[map.devices.map(node), map.servers.map(node)]}
        lines={map.lines}
        summary={map.summary}
      />
    </div>
  );
}
