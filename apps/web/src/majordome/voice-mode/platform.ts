import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { pickSpeechLanguage } from "@t3tools/client-runtime/speaking/language";
import { VoiceTranscriptionError } from "@t3tools/client-runtime/voice-input";
import type { CloudSpeechModelId, CloudSpeechProvider } from "@t3tools/contracts";
import { resolveSpeechVocabulary } from "@t3tools/shared/speech";
import * as Schema from "effect/Schema";
import { decodeOptions, msg } from "gt-react";

import { toastManager } from "~/components/ui/toast";
import { isMajordome } from "~/env";
import { getClientSettings } from "~/hooks/useSettings";
import { getActiveLocale, m } from "~/i18n/messages";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { chooseRecordingMicrophone } from "~/speech/browserMicrophones";
import {
  createAppleSpeechVoiceInputPlatform,
  createBrowserVoiceInputPlatform,
} from "~/speech/browserVoiceInput";
import { requestMicrophone } from "~/speech/requestMicrophone";
import { bindAudioGrant } from "~/speech/voiceConsent";
import { environmentPresentations } from "~/state/presentation";
import { environmentThreadDetails } from "~/state/threads";

import { onDictationStarted } from "../speaking/dictationBus";
import { readAloud } from "../speaking/platform";
import type { ReadAloudRuntime } from "../speaking/runtime";
import { createConversationEars, isWordedEarsError, type EarsCapture } from "./conversationEars";
import { createTurnReplyRouter } from "./turnReply";
import { createVoiceModeRuntime, type VoiceModeRuntime } from "./voiceModeRuntime";

/** Where the user's dictation is transcribed, as the composer's own voice input resolves it. */
export interface VoiceModeEarsDestination {
  readonly grantId: string | null;
  readonly prepared: PreparedConnection | null;
  readonly onDevice: boolean;
  readonly cloudProvider?: CloudSpeechProvider | undefined;
  readonly cloudModel?: CloudSpeechModelId | undefined;
}

/**
 * What a scenario puts on `window.__majordomeVoiceMode` before the app loads: with `fakeEars`
 * no microphone opens, and each turn's words come from `say`, which the app adds. A development
 * build adds `say` on its own, to type a turn in beside the real microphone.
 */
export interface VoiceModeSeam {
  readonly fakeEars?: boolean;
  say?: (text: string) => void;
}

const THINKING_PULSE_MS = 4_000;
/** A reconnect this quick is not worth telling the user about. */
const CONNECTION_GRACE_MS = 4_000;
/** The capture's meter falls for about half a second after the voice does. */
const QUIET_AFTER_SPEECH_MS = 1_600;

const NEEDS_YOU = msg("I need your answer on screen.");
const CONNECTION_LOST = msg("The connection was lost.");

const isVoiceTranscriptionError = Schema.is(VoiceTranscriptionError);

/** What a `msg()` string says in English, whatever the app's language. */
const english = (marked: string) => {
  const source = decodeOptions(marked)?.$_source;
  return typeof source === "string" ? source : marked;
};

/** In a development build only: "1" here stands in for `fakeEars`, for a window with no microphone. */
const DEV_FAKE_EARS_KEY = "majordome:voice-fake-ears";

function readSeam(): VoiceModeSeam | null {
  if (typeof window === "undefined") return null;
  const scope = window as { __majordomeVoiceMode?: VoiceModeSeam };
  if (!scope.__majordomeVoiceMode && import.meta.env.DEV) {
    let fakeEars = false;
    try {
      fakeEars = localStorage.getItem(DEV_FAKE_EARS_KEY) === "1";
    } catch {}
    scope.__majordomeVoiceMode = { fakeEars };
  }
  return scope.__majordomeVoiceMode ?? null;
}

const seam = readSeam();
/** True where a scenario speaks for the user: no microphone and no transcription are needed. */
export const voiceModeFakeEars = seam?.fakeEars === true;

let destination: VoiceModeEarsDestination | null = null;

/** The chat on screen says where its dictation goes; a conversation transcribes there too. */
export function setVoiceModeEarsDestination(next: VoiceModeEarsDestination): void {
  destination = next;
}

function openCapture(events: {
  readonly onLevel: (level: number) => void;
  readonly onDurationLimit: () => void;
  readonly onError: (message: string) => void;
}): EarsCapture | null {
  const target = destination;
  if (!target?.grantId) return null;
  const input = {
    hasAudioConsent: bindAudioGrant(target.grantId),
    getTranscriptionOptions: () => {
      const settings = getClientSettings();
      const { speechCustomWords, speechHints } = resolveSpeechVocabulary({
        personal: settings.speechCustomWords,
        project: [],
        hints: [],
      });
      return {
        speechLanguage: settings.speechLanguage,
        speechTranslateToEnglish: settings.speechTranslateToEnglish,
        speechCustomWords,
        ...(speechHints.length > 0 ? { speechHints } : {}),
        speechRemoveFillerWords: settings.speechRemoveFillerWords,
        speechSilenceFiltering: settings.speechSilenceFiltering,
      };
    },
    getMicrophoneId: chooseRecordingMicrophone,
    ...events,
  };
  if (target.onDevice) return createAppleSpeechVoiceInputPlatform(input);
  if (!target.prepared) return null;
  return createBrowserVoiceInputPlatform({
    ...input,
    prepared: target.prepared,
    cloudProvider: target.cloudProvider,
    cloudModel: target.cloudModel,
    // A turn is short and wanted whole: no partial text is shown, so nothing is streamed for it.
    getStreamingEnabled: () => false,
    onText: () => {},
  });
}

function create(voice: ReadAloudRuntime): VoiceModeRuntime {
  const registry = appAtomRegistry;
  const mouth = voice.conversation;

  const ears = createConversationEars({
    open: openCapture,
    now: () => performance.now(),
    setTimer: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    endOfTurn: { quietMs: QUIET_AFTER_SPEECH_MS },
  });

  let injected: ((text: string) => void) | null = null;
  if (seam) seam.say = (text) => injected?.(text);

  const listen = (signal: AbortSignal) =>
    new Promise<{ readonly text: string } | { readonly gaveUp: true }>((resolve, reject) => {
      const onAbort = () => reject(signal.reason ?? new Error("voice-mode: listening stopped"));
      injected = (text) => {
        injected = null;
        signal.removeEventListener("abort", onAbort);
        resolve({ text });
        ears.sendNow();
      };
      if (voiceModeFakeEars) {
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
        return;
      }
      ears.listen(signal).then(resolve, reject);
    });

  return createVoiceModeRuntime({
    ears: {
      permit: async () => {
        if (voiceModeFakeEars) return true;
        try {
          const stream = await requestMicrophone(await chooseRecordingMicrophone());
          for (const track of stream.getTracks()) track.stop();
          return true;
        } catch {
          return false;
        }
      },
      listen: (signal) => (seam ? listen(signal) : ears.listen(signal)),
      sendNow: () => ears.sendNow(),
    },
    mouth: {
      hold: (onTaken) => mouth.hold(onTaken),
      speak: (sentence, lang) => mouth.speak(sentence, lang),
      stop: () => mouth.stop(),
      onDrained: mouth.onDrained,
      onSentence: mouth.onSentence,
    },
    watchTurn: (chatKey, messageId, reply, onAnswered) => {
      const chat = parseScopedThreadKey(chatKey);
      if (!chat) return () => {};
      const router = createTurnReplyRouter();
      const threadAtom = environmentThreadDetails.threadAtom(chat);
      const requestsAtom = environmentThreadDetails.pendingRequestsAtom(chat);
      const environmentAtom = environmentPresentations.presentationAtom(chat.environmentId);
      let connected = true;
      let lost: ReturnType<typeof setTimeout> | null = null;
      const push = () => {
        const projection = registry.get(threadAtom)?.projection;
        const requests = registry.get(requestsAtom);
        const approval = requests?.approvals[0];
        const question = requests?.userInputs[0];
        router.update({
          runs: projection?.runs ?? [],
          messages: projection?.messages ?? [],
          needs: approval
            ? { kind: "approval", id: approval.requestId }
            : question
              ? { kind: "question", id: question.requestId }
              : null,
          connected,
        });
      };
      const connection = () => {
        const online = registry.get(environmentAtom)?.connection.phase === "connected";
        if (online) {
          if (lost) clearTimeout(lost);
          lost = null;
          if (!connected) {
            connected = true;
            push();
          }
        } else if (connected) {
          lost ??= setTimeout(() => {
            lost = null;
            connected = false;
            push();
          }, CONNECTION_GRACE_MS);
        }
      };
      const unwatch = router.watch(messageId, reply, onAnswered);
      const stops = [
        registry.subscribe(threadAtom, push),
        registry.subscribe(requestsAtom, push),
        registry.subscribe(environmentAtom, connection),
      ];
      connection();
      push();
      return () => {
        unwatch();
        if (lost) clearTimeout(lost);
        for (const stop of stops) stop();
      };
    },
    cue: mouth.cue,
    pulse: (tick) => {
      const interval = setInterval(tick, THINKING_PULSE_MS);
      return () => clearInterval(interval);
    },
    language: (text) => pickSpeechLanguage(text, getActiveLocale(), mouth.languages),
    phrase: (kind, lang) => {
      const marked = kind === "connection-lost" ? CONNECTION_LOST : NEEDS_YOU;
      const app = getActiveLocale().toLowerCase().split(/[-_]/)[0] ?? "en";
      // The app's own translation when the reply is in the app's language; English otherwise,
      // which the voice always speaks.
      if (lang === app) return { text: m(marked), lang };
      if (lang === "en" || !mouth.languages.includes(app)) {
        return { text: english(marked), lang: "en" };
      }
      return { text: m(marked), lang: app };
    },
    speakable: mouth.placeholders,
    onTakenAway: (callback) => {
      const stops = [onDictationStarted(callback), mouth.onError(callback)];
      window.addEventListener("pagehide", callback);
      return () => {
        for (const stop of stops) stop();
        window.removeEventListener("pagehide", callback);
      };
    },
    reportError: (reason, error) => {
      if (reason === "microphone") {
        toastManager.add({
          type: "error",
          title: m(msg("Microphone access is off")),
          description: m(msg("Allow the microphone to talk with your assistant.")),
        });
        return;
      }
      toastManager.add({
        type: "error",
        title: m(msg("Voice mode stopped")),
        description:
          isWordedEarsError(error) || isVoiceTranscriptionError(error)
            ? error.message
            : m(msg("Try again.")),
      });
    },
    setTimer: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
  });
}

let runtime: VoiceModeRuntime | null = null;
const listeners = new Set<() => void>();

function start() {
  const voice = readAloud.get();
  if (runtime || !voice || !isMajordome) return;
  runtime = create(voice);
  for (const listener of listeners) listener();
}
readAloud.subscribe(start);
start();

/** Talking with the assistant in this window; null where the voice cannot run. */
export const voiceMode = {
  get: (): VoiceModeRuntime | null => runtime,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Starts talking in a chat, after the voice's download when it is not on this computer yet. */
export function openVoiceMode(chatKey: string): void {
  const voice = readAloud.get();
  const conversation = runtime;
  if (!voice || !conversation) return;
  void voice.conversation.whenVoiceReady(() => void conversation.open(chatKey));
}
