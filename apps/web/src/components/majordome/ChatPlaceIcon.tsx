import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { CloudIcon, LaptopIcon, ServerIcon } from "lucide-react";

import { environmentCatalog } from "../../connection/catalog";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isHostedServer, onMachine } from "./brains.logic";
import { useMachineNames } from "./useMachineNames";

/** "kept on this Mac", "kept on your server": where a chat is, for a tooltip. */
export function useChatPlaceWords() {
  const { machineOf } = useMachineNames();
  return (environmentId: EnvironmentId) => `kept ${onMachine(machineOf(environmentId))}`;
}

/**
 * Which machine keeps a chat, for notes that are on several: a cloud for a server Majordome
 * hosts, a server for one the owner runs, a laptop for a computer. Shown beside the chat's name, and read out for those who do not see it.
 */
export function ChatPlaceIcon(props: {
  readonly environmentId: EnvironmentId;
  /** Where the notes' conversations are kept, when known. */
  readonly homeEnvironmentId: EnvironmentId | null;
  readonly className?: string;
}) {
  const { primaryEnvironmentId, machineOf } = useMachineNames();
  const words = useChatPlaceWords();
  // Conversations are kept away from this window's own machine only on an always-on server.
  const Icon = isHostedServer(machineOf(props.environmentId))
    ? CloudIcon
    : props.environmentId !== primaryEnvironmentId &&
        props.environmentId === props.homeEnvironmentId
      ? ServerIcon
      : LaptopIcon;
  return (
    <>
      <Icon className={cn("size-3.5 shrink-0", props.className)} aria-hidden />
      <span className="sr-only">{words(props.environmentId)}</span>
    </>
  );
}

/**
 * In a chat's message box: which of the owner's computers answers what is sent from it. With one
 * computer there is nothing to tell, so nothing shows. Each computer has its own keys, files and
 * sign-ins, so an answer depends on where it is made.
 */
export function AnswersOnIcon(props: { readonly environmentId: EnvironmentId }) {
  const { primaryEnvironmentId, machineOf } = useMachineNames();
  const several = useAtomValue(environmentCatalog.catalogValueAtom).entries.size > 1;
  if (!several) return null;
  const name = machineOf(props.environmentId);
  const Icon = isHostedServer(name)
    ? CloudIcon
    : props.environmentId === primaryEnvironmentId
      ? LaptopIcon
      : ServerIcon;
  const words = `Answered ${onMachine(name)}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={words}
            data-answers-on={props.environmentId}
            className="flex size-7 shrink-0 items-center justify-center text-muted-foreground"
          />
        }
      >
        <Icon className="size-4" aria-hidden />
      </TooltipTrigger>
      <TooltipPopup side="top">{words}</TooltipPopup>
    </Tooltip>
  );
}
