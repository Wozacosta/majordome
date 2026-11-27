import { voiceDownloadMegabytes } from "@t3tools/client-runtime/speaking/voice-catalog";
import { T, useGT } from "gt-react";
import { useSyncExternalStore } from "react";

import {
  Dialog,
  DialogAction,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";

import type { ReadAloudRuntime } from "./runtime";

/** First use of the voice: its size, one button, and the progress of the download. */
export function VoiceDownloadDialog({ runtime }: { readonly runtime: ReadAloudRuntime }) {
  const gt = useGT();
  const open = useSyncExternalStore(runtime.downloadOffered.subscribe, runtime.downloadOffered.get);
  const state = useSyncExternalStore(runtime.store.subscribe, runtime.store.getState);
  const megabytes = voiceDownloadMegabytes(runtime.catalog);
  const percent =
    state.status === "downloading" ? Math.floor((state.received / state.total) * 100) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) runtime.dismissDownload();
      }}
    >
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{gt("Download the voice ({megabytes} MB)", { megabytes })}</DialogTitle>
        </DialogHeader>
        <DialogPanel scrollFade={false}>
          {state.status === "downloading" ? (
            <div
              role="progressbar"
              aria-label={gt("Downloading the voice")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="my-3 h-2 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
          ) : (
            <div className="space-y-3">
              {state.status === "failed" ? (
                <p role="alert" className="text-sm text-destructive-foreground">
                  {state.reason === "verification"
                    ? gt("The download was damaged. Try again.")
                    : gt("The download stopped. Try again.")}
                </p>
              ) : null}
              <DialogAction className="w-full" onClick={() => void runtime.download()}>
                <T>Download</T>
              </DialogAction>
            </div>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
