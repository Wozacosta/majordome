import { useGT } from "gt-react";
import { AudioLinesIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useVoiceTranscriptionDestination } from "~/speech/useEnvironmentSpeechInput";

import { offerVoiceMode } from "./entries";
import { openVoiceMode, setVoiceModeEarsDestination, voiceModeFakeEars } from "./platform";
import { useVoiceMode, useVoiceModeSnapshot } from "./useVoiceMode";

/** As much of the composer's own dictation as a conversation needs to know. */
interface ComposerDictation {
  /** Dictation is offered here: a microphone, and somewhere to transcribe or its setup. */
  readonly available: boolean;
  readonly state: { readonly phase: string };
  readonly status: { readonly supported: boolean; readonly state?: string } | null;
  /** Starts dictation, or the setup it still needs. */
  readonly start: () => Promise<void>;
}

/**
 * Talking in the composer's chat: the button shown where Send sits while the composer is
 * empty, or null where talking is not possible, and whether a conversation covers the composer.
 */
export function useVoiceModeEntry(input: {
  readonly chatKey: string;
  readonly dictation: ComposerDictation;
  /** The composer cannot take a message now: read-only, disconnected, or an approval is open. */
  readonly disabled: boolean;
  /** The composer holds something to send, so Send keeps its place. */
  readonly hasContent: boolean;
  readonly shortcutLabel: string | null;
}): { readonly button: ReactNode; readonly covers: boolean } {
  const gt = useGT();
  const runtime = useVoiceMode();
  const snapshot = useVoiceModeSnapshot(runtime);
  const destination = useVoiceTranscriptionDestination();
  const { chatKey, dictation } = input;
  const { grantId, prepared, cloudProvider, cloudModel } = destination;
  const onDevice = destination.onDevice === true;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a conversation runs outside React and transcribes where this chat's dictation does
  useEffect(() => {
    setVoiceModeEarsDestination({ grantId, prepared, onDevice, cloudProvider, cloudModel });
  }, [grantId, prepared, onDevice, cloudProvider, cloudModel]);

  const offered =
    runtime !== null &&
    snapshot.chatKey === null &&
    !input.disabled &&
    !input.hasContent &&
    dictation.state.phase === "idle" &&
    (voiceModeFakeEars || dictation.available);
  // Dictation's own first-run path: choose where speech is transcribed, or download its model.
  const needsSetup =
    !voiceModeFakeEars &&
    (grantId === null ||
      (dictation.status?.supported && dictation.status.state === "missing-model"));
  const start = useStableCallback(() => {
    if (needsSetup) void dictation.start();
    else openVoiceMode(chatKey);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the shortcut and the command palette which chat on screen can be talked in
  useEffect(
    () => (offered ? offerVoiceMode({ chatKey, start }) : undefined),
    [offered, chatKey, start],
  );

  const label = gt("Talk", { $context: "verb, start talking with the assistant" });
  return {
    covers: snapshot.chatKey === chatKey && snapshot.state !== "needs-you",
    button: offered ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={label}
              data-voice-mode-start="true"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-message-action text-message-action-foreground shadow-xs inset-shadow-control-highlight transition-all duration-150 hover:scale-105 hover:bg-message-action-hover active:inset-shadow-control-pressed active:shadow-none sm:h-8 sm:w-8 [&_svg]:pointer-events-none"
              onClick={start}
            />
          }
        >
          <AudioLinesIcon className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipPopup side="top">
          {label}
          {input.shortcutLabel ? ` (${input.shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    ) : null,
  };
}
