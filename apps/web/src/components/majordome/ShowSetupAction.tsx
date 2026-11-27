import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { SHOW_SETUP_LABEL } from "@t3tools/shared/majordome";
import { AsyncResult } from "effect/reactivity";
import { WaypointsIcon } from "lucide-react";
import { useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { HtmlRenderFrame } from "../chat/HtmlRenderFrame";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface ChatTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

/** Opens the map of what the assistant knows, can use and can reach in this chat. */
export function ShowSetupAction(props: ChatTarget) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={SHOW_SETUP_LABEL}
              onClick={() => setOpen(true)}
            />
          }
        >
          <WaypointsIcon />
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          What the assistant knows, can use and can reach in this chat
        </TooltipPopup>
      </Tooltip>
      {open ? <SetupMapDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SetupMapDialog(props: ChatTarget & { readonly onClose: () => void }) {
  const { environmentId, threadId } = props;
  // Drawn by the server from what it holds, so it opens without a turn of the assistant.
  const result = useAtomValue(
    majordomeEnvironment.chatSetupPage({ environmentId, input: { threadId } }),
  );
  const page = result.waiting ? null : AsyncResult.getOrElse(result, () => null);
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{SHOW_SETUP_LABEL}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {page !== null ? (
            <HtmlRenderFrame
              key={page.attachmentId}
              environmentId={environmentId}
              htmlRender={page}
              threadRef={scopeThreadRef(environmentId, threadId)}
            />
          ) : result.waiting ? (
            <div className="flex h-64 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              The map could not be drawn. Close this and try again.
            </p>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
