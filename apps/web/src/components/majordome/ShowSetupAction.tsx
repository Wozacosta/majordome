import { SHOW_SETUP_LABEL, SHOW_SETUP_REQUEST } from "@t3tools/shared/majordome";
import { WaypointsIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Asks the assistant, in one click, to draw what it knows, can use and can reach in this chat. */
export function ShowSetupAction(props: { readonly onSend: (text: string) => Promise<void> }) {
  const [sending, setSending] = useState(false);
  const send = () => {
    setSending(true);
    props
      .onSend(SHOW_SETUP_REQUEST)
      .catch(() => {
        toastManager.add({ type: "error", title: "Could not ask for the drawing. Try again." });
      })
      .finally(() => setSending(false));
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={SHOW_SETUP_LABEL}
            disabled={sending}
            onClick={send}
          />
        }
      >
        <WaypointsIcon />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        Draw what the assistant knows, can use and can reach in this chat
      </TooltipPopup>
    </Tooltip>
  );
}
