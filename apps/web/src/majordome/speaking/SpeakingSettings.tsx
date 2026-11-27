import { voiceDownloadMegabytes } from "@t3tools/client-runtime/speaking/voice-catalog";
import { T, useGT, useLocale } from "gt-react";
import { PlayIcon, SquareIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { useSearchableSetting } from "~/components/settings/settingsSearch";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import { setReadAloudAppLanguage } from "./appLanguage";
import { voiceSampleKey } from "./keys";
import type { ReadAloudRuntime } from "./runtime";
import { useReadAloud } from "./useReadAloud";

/** The voice that reads replies aloud: which one, and removing its download. */
export function SpeakingSettings() {
  const runtime = useReadAloud();
  return runtime ? <Speaking runtime={runtime} /> : null;
}

function Speaking({ runtime }: { readonly runtime: ReadAloudRuntime }) {
  const gt = useGT();
  const locale = useLocale();
  const setting = useSearchableSetting();
  const state = useSyncExternalStore(runtime.store.subscribe, runtime.store.getState);
  const chosen = useSyncExternalStore(runtime.voice.subscribe, runtime.voice.get);
  const sampling = useSyncExternalStore(runtime.controller.subscribe, () => {
    const speaking = runtime.controller.getState();
    return speaking.status !== "idle" && speaking.key === voiceSampleKey(chosen);
  });
  const [voices, setVoices] = useState(0);
  const [removing, setRemoving] = useState(false);
  const ready = state.status === "ready";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the files in the browser's storage say whether the voice is there; a sample stops when the page closes
  useEffect(() => {
    void runtime.store.refresh();
    return () => {
      const speaking = runtime.controller.getState();
      if (speaking.status !== "idle" && speaking.key.startsWith("voice:")) {
        runtime.controller.stop();
      }
    };
  }, [runtime]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- only the downloaded voice file says how many voices it holds
  useEffect(() => {
    if (!ready) return;
    let current = true;
    void runtime.voiceCount().then(
      (count) => current && setVoices(count),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [ready, runtime]);

  const megabytes = voiceDownloadMegabytes(runtime.catalog);
  const voiceLabel = (voice: number) => gt("Voice {number}", { number: voice + 1 });
  const section = setting("voice-speaking");

  if (!ready) {
    return (
      <SettingsSection id={section.id} title={gt("Speaking")}>
        <SettingsRow
          title={gt("Voice", { $context: "the voice that reads replies aloud" })}
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={state.status === "downloading"}
              onClick={() => runtime.offerDownload()}
            >
              {state.status === "downloading"
                ? gt("Downloading the voice")
                : gt("Download the voice ({megabytes} MB)", { megabytes })}
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection id={section.id} title={gt("Speaking")}>
      <SettingsRow
        title={gt("Voice", { $context: "the voice that reads replies aloud" })}
        control={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={
                sampling
                  ? gt("Stop", { $context: "stop reading aloud" })
                  : gt("Listen to {voice}", { voice: voiceLabel(chosen) })
              }
              onClick={() => {
                setReadAloudAppLanguage(locale);
                void runtime.toggle({
                  key: voiceSampleKey(chosen),
                  voice: chosen,
                  markdown: gt("Hello. This is how I sound when I read a reply to you."),
                });
              }}
            >
              {sampling ? <SquareIcon /> : <PlayIcon />}
            </Button>
            <Select
              value={String(chosen)}
              onValueChange={(value) => {
                if (value === null) return;
                runtime.controller.stop();
                runtime.voice.set(Number(value));
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={gt("Voice", { $context: "the voice that reads replies aloud" })}
              >
                <SelectValue>{voiceLabel(chosen)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {Array.from({ length: Math.max(voices, chosen + 1) }, (_, voice) => (
                  <SelectItem key={voice} value={String(voice)}>
                    {voiceLabel(voice)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        }
      />
      <SettingsRow
        title={gt("Downloaded voice ({megabytes} MB)", { megabytes })}
        control={
          <Button variant="destructive-outline" size="sm" onClick={() => setRemoving(true)}>
            <T>Remove the download</T>
          </Button>
        }
      />
      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>Remove the voice?</T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>Reading aloud will ask to download it again.</T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setRemoving(false);
                void runtime.remove();
              }}
            >
              <T>Remove</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}
