import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { SHOW_SETUP_LABEL, START_ABOUT_YOU_LABEL } from "@t3tools/shared/majordome";
import { AsyncResult } from "effect/reactivity";
import { UserIcon, WaypointsIcon } from "lucide-react";
import { useState } from "react";

import { useQuietThreadShell } from "../../state/entities";
import { majordomeEnvironment } from "../../state/majordome";
import { HtmlRenderFrame } from "../chat/HtmlRenderFrame";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useStartAboutYou } from "./useStartAboutYou";

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
  // The map says "Nothing yet" for a note that does not exist; the way to start it is beside it.
  const knowledge = AsyncResult.getOrElse(
    useAtomValue(majordomeEnvironment.chatKnowledge({ environmentId, input: { threadId } })),
    () => null,
  );
  const projectId = useQuietThreadShell(scopeThreadRef(environmentId, threadId))?.projectId;
  const startAboutYou = useStartAboutYou();
  const canStartAboutYou =
    knowledge !== null && knowledge.isVault && knowledge.me === null && projectId !== undefined;
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{SHOW_SETUP_LABEL}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {canStartAboutYou ? (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-primary/25 bg-primary/5 py-2 pr-2 pl-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <UserIcon className="size-4" aria-hidden />
              </span>
              <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">
                <span className="font-semibold text-primary">About you</span> is empty. Your
                assistant can write it from what your notes already say.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  props.onClose();
                  void startAboutYou(scopeProjectRef(environmentId, projectId));
                }}
              >
                {START_ABOUT_YOU_LABEL}
              </Button>
            </div>
          ) : null}
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
