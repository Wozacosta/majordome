import type { EnvironmentId } from "@t3tools/contracts";
import { LaptopIcon, ServerIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { onMachine } from "./brains.logic";
import { useMachineNames } from "./useMachineNames";

/** "kept on this Mac", "kept on Always-on server": where a chat is, for a tooltip. */
export function useChatPlaceWords() {
  const { machineOf } = useMachineNames();
  return (environmentId: EnvironmentId) => `kept ${onMachine(machineOf(environmentId))}`;
}

/**
 * Which machine keeps a chat, for notes that are on several: a server for the always-on one, a
 * laptop for a computer. Shown beside the chat's name, and read out for those who do not see it.
 */
export function ChatPlaceIcon(props: {
  readonly environmentId: EnvironmentId;
  /** Where the notes' conversations are kept, when known. */
  readonly homeEnvironmentId: EnvironmentId | null;
  readonly className?: string;
}) {
  const { primaryEnvironmentId } = useMachineNames();
  const words = useChatPlaceWords();
  // Conversations are kept away from this window's own machine only on an always-on server.
  const Icon =
    props.environmentId !== primaryEnvironmentId && props.environmentId === props.homeEnvironmentId
      ? ServerIcon
      : LaptopIcon;
  return (
    <>
      <Icon className={cn("size-3.5 shrink-0", props.className)} aria-hidden />
      <span className="sr-only">{words(props.environmentId)}</span>
    </>
  );
}
