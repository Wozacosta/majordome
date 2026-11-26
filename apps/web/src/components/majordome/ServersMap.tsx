import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { CloudIcon, LaptopIcon, ServerIcon, SmartphoneIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { majordomeEnvironment } from "../../state/majordome";
import { Badge } from "../ui/badge";
import { Muted } from "./paper";
import { phoneWithNotifications } from "./phone.logic";
import type { ServerRow } from "./servers.logic";
import {
  MAP_NODE_GAP,
  MAP_NODE_HEIGHT,
  serversMap,
  type ServersMap as ServersMapModel,
  serversMapLayout,
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
export function ServersMap({ servers }: { readonly servers: ReadonlyArray<ServerRow> }) {
  const phone = usePhoneEnvironment();
  return phone === null ? (
    <Drawing servers={servers} phone={null} />
  ) : (
    <WithPhone servers={servers} phone={phone} />
  );
}

function WithPhone({
  servers,
  phone,
}: {
  readonly servers: ReadonlyArray<ServerRow>;
  readonly phone: PhoneEnvironment;
}) {
  const devices = useAtomValue(
    majordomeEnvironment.pushDevices({ environmentId: phone.environmentId, input: {} }),
  );
  // A computer that cannot say leaves the phone off the drawing, not "not set up".
  const known = AsyncResult.getOrElse(devices, () => null);
  return (
    <Drawing
      servers={servers}
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
}: {
  readonly servers: ReadonlyArray<ServerRow>;
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
  const layout = serversMapLayout(map.devices.length, map.servers.length);
  const middle = (id: string) => {
    const device = map.devices.findIndex((node) => node.id === id);
    return device >= 0
      ? layout.middleOf(layout.deviceOffset, device)
      : layout.middleOf(
          layout.serverOffset,
          map.servers.findIndex((node) => node.id === id),
        );
  };
  const hasMain = [...map.devices, ...map.servers].some((node) => node.main);
  return (
    // Below this width the two columns would be too narrow to read; the list says it all.
    <div className="mb-4 hidden sm:block">
      <div
        role="group"
        aria-label={map.summary}
        className="grid grid-cols-[minmax(0,5fr)_minmax(0,2fr)_minmax(0,5fr)]"
        style={{ height: layout.height }}
      >
        <Column nodes={map.devices} offset={layout.deviceOffset} />
        <svg
          aria-hidden
          viewBox={`0 0 100 ${layout.height}`}
          preserveAspectRatio="none"
          className="size-full"
        >
          {map.lines.map((line) => {
            const from = middle(line.from);
            const to = middle(line.to);
            return (
              <path
                key={`${line.from}:${line.to}`}
                d={`M 0 ${from} C 50 ${from}, 50 ${to}, 100 ${to}`}
                fill="none"
                vectorEffect="non-scaling-stroke"
                strokeWidth={1.5}
                strokeDasharray={line.live ? undefined : "4 4"}
                className={line.live ? "stroke-success" : "stroke-muted-foreground/50"}
              />
            );
          })}
        </svg>
        <Column nodes={map.servers} offset={layout.serverOffset} />
      </div>
      {hasMain ? (
        <Muted className="mt-2 text-xs">
          Main is where the assistant answers and your chats are kept.
        </Muted>
      ) : null}
    </div>
  );
}

function Column({
  nodes,
  offset,
}: {
  readonly nodes: ReadonlyArray<ServersMapNode>;
  readonly offset: number;
}) {
  return (
    <div className="flex min-w-0 flex-col" style={{ paddingTop: offset, gap: MAP_NODE_GAP }}>
      {nodes.map((node) => {
        const Icon = NODE_ICONS[node.kind];
        const className = cn(
          "flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg border bg-card px-3",
          node.main ? "border-primary/60" : "border-border",
          node.faint && "border-dashed opacity-70",
        );
        const inside = (
          <>
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{node.title}</p>
              {node.detail === null ? null : (
                <p className="truncate text-xs text-muted-foreground">{node.detail}</p>
              )}
            </div>
            {node.main ? <Badge size="sm">Main</Badge> : null}
          </>
        );
        // The phone is set up, and changed, on its own settings page.
        return node.kind === "phone" ? (
          <Link
            key={node.id}
            to="/settings/phone"
            style={{ height: MAP_NODE_HEIGHT }}
            className={cn(
              className,
              "outline-none hover:border-primary/60 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            )}
          >
            {inside}
          </Link>
        ) : (
          <div key={node.id} style={{ height: MAP_NODE_HEIGHT }} className={className}>
            {inside}
          </div>
        );
      })}
    </div>
  );
}
