import { pickSpeechLanguage } from "@t3tools/client-runtime/speaking/language";
import { VOICE_CATALOG } from "@t3tools/client-runtime/speaking/voice-catalog";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  AudioModule,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  type AudioPlayer,
  type RecordingStatus,
} from "expo-audio";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { decodeOptions, msg } from "gt-react-native";
import { Linking } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { createLazyVoiceRecorder } from "../../features/voice-input/lazyVoiceRecorder";
import {
  localVoiceTranscriberAtom,
  VOICE_RECORDING_OPTIONS,
} from "../../features/voice-input/VoiceInputProvider";
import { voiceRouteAtom } from "../../features/voice-input/voiceDestination";
import { m } from "../../i18n/messages";
import {
  acquireAudioSession,
  activateAudioSession,
  releaseAudioSession,
} from "../../lib/audioSession";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { majordomeSpeech } from "../../native/majordomeSpeech";
import { createVoiceRecorder } from "../../native/voiceRecorder";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { environmentThreadDetails } from "../../state/threads";
import { watchLeftApp } from "../speaking/leftApp";
import { announceAndWait, readAloud } from "../speaking/platform";
import { DEV_EARS } from "./availability";
import { createConversationEars } from "./conversationEars";
import { armSpokenReply } from "./spokenSend";
import { createTurnReplyRouter } from "./turnReply";
import {
  createVoiceModeRuntime,
  type VoiceModeHost,
  type VoiceModeRuntime,
} from "./voiceModeRuntime";

export interface VoiceModeChat {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

const METERING_INTERVAL_MS = 80;
const THINKING_PULSE_MS = 4_000;
/** A reconnect this quick is not worth telling the user about. */
const CONNECTION_GRACE_MS = 4_000;

const NEEDS_YOU = msg("I need your answer on screen.");
const CONNECTION_LOST = msg("The connection was lost.");

let appLanguage = "en";
const chats = new Map<string, VoiceModeChat>();

/** What a `msg()` string says in English, whatever the app's language. */
const english = (marked: string) => {
  const source = decodeOptions(marked)?.$_source;
  return typeof source === "string" ? source : marked;
};

function createCuePlayer(source: number, volume: number): () => void {
  let player: AudioPlayer | null = null;
  return () => {
    try {
      player ??= createAudioPlayer(source);
      player.volume = volume;
      void player.seekTo(0).catch(() => {});
      player.play();
    } catch {}
  };
}

function create(): VoiceModeRuntime | null {
  const speech = majordomeSpeech;
  if (!speech || !readAloud) return null;
  const voice = readAloud;
  const registry = appAtomRegistry;

  const hasLocalTranscriber = () => {
    const local = registry.get(localVoiceTranscriberAtom);
    return local !== null && local !== "checking";
  };
  const recorder = createLazyVoiceRecorder({
    getDestination: () => (registry.get(voiceRouteAtom) === null ? "local" : "environment"),
    create: (destination) =>
      // Android's live recorder feeds the phone's recogniser and stalls with nobody reading it.
      destination === "local" && hasLocalTranscriber()
        ? createVoiceRecorder(VOICE_RECORDING_OPTIONS)
        : new AudioModule.AudioRecorder(VOICE_RECORDING_OPTIONS),
    onStatus: (status: RecordingStatus) => {
      if (status.hasError || status.mediaServicesDidReset === true) {
        ears.recorderStopped(status.error ?? "The microphone stopped.");
      } else if (status.isFinished) ears.recorderStopped();
    },
  });
  const ears = createConversationEars({
    recorder: {
      get uri() {
        return recorder.uri;
      },
      prepareToRecordAsync: (signal) => recorder.prepareToRecordAsync(signal),
      record: (options) => recorder.record(options),
      stop: () => recorder.stop(),
      level: () => {
        const status = recorder.getStatus();
        return status?.isRecording ? status.metering : null;
      },
    },
    getTranscriber: () => {
      const route = registry.get(voiceRouteAtom);
      if (route) return route.transcriber;
      const local = registry.get(localVoiceTranscriberAtom);
      if (local !== null && local !== "checking") return local;
      // Hears nothing: the recorder still runs, and the words come from the developer's link.
      return DEV_EARS
        ? { prepare: async () => ({ locale: "en-US", transcribe: async () => "" }) }
        : null;
    },
    deleteRecording: (uri) => new File(uri).delete(),
    now: () => Date.now(),
    every: (tick) => {
      const interval = setInterval(tick, METERING_INTERVAL_MS);
      return () => clearInterval(interval);
    },
  });

  // A transcript handed in by a developer, for a simulator whose microphone hears nothing:
  // `<scheme>://expo-sharing?voice-say=<words>`, a link the app's navigation leaves alone.
  let injected: ((text: string) => void) | null = null;
  if (__DEV__) {
    Linking.addEventListener("url", ({ url }) => {
      const said = /[?&]voice-say=([^&]+)/.exec(url)?.[1];
      if (said !== undefined) injected?.(decodeURIComponent(said.replace(/\+/g, " ")));
    });
  }

  const playSent = createCuePlayer(require("../../../assets/sounds/voice-sent.wav"), 0.6);
  const playThinking = createCuePlayer(require("../../../assets/sounds/voice-thinking.wav"), 0.5);

  return createVoiceModeRuntime({
    ears: {
      permit: async () => (await requestRecordingPermissionsAsync()).granted,
      listen: (signal) => {
        if (!__DEV__) return ears.listen(signal);
        return new Promise((resolve, reject) => {
          injected = (text) => {
            injected = null;
            resolve({ text });
            ears.sendNow();
          };
          ears.listen(signal).then(resolve, reject);
        });
      },
      sendNow: () => ears.sendNow(),
    },
    mouth: {
      hold: () => voice.hold(),
      speak: (sentence, lang) => speech.speak(sentence, { voice: voice.getVoice(), lang }),
      stop: () => speech.stop(),
      onDrained: (callback) => {
        const subscription = speech.addListener("drained", callback);
        return () => subscription.remove();
      },
      onSentence: (callback) => {
        const subscription = speech.addListener("sentenceStarted", (event) => callback(event.id));
        return () => subscription.remove();
      },
    },
    takeAudio: async (onTaken) => {
      const token = acquireAudioSession("conversation", onTaken);
      const release = () => {
        recorder.release();
        speech.holdAudio?.(false);
        void releaseAudioSession(token).catch(() => {});
      };
      if (
        (await activateAudioSession(token).catch(() => false)) &&
        (speech.holdAudio?.(true) ?? true)
      ) {
        return release;
      }
      release();
      return null;
    },
    watchTurn: (chatKey, messageId, reply, onAnswered) => {
      const chat = chats.get(chatKey);
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
    armSpokenReply,
    cue: (kind) => {
      if (kind === "sent") {
        playSent();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } else {
        playThinking();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
      }
    },
    pulse: (tick) => {
      const interval = setInterval(tick, THINKING_PULSE_MS);
      return () => clearInterval(interval);
    },
    language: (text) => pickSpeechLanguage(text, appLanguage, VOICE_CATALOG.languages),
    phrase: (kind, lang) => {
      const marked = kind === "connection-lost" ? CONNECTION_LOST : NEEDS_YOU;
      const app = appLanguage.toLowerCase().split(/[-_]/)[0] ?? "en";
      // The app's own translation when the reply is in the app's language; English otherwise,
      // which the voice always speaks.
      if (lang === app) return { text: m(marked), lang };
      if (lang === "en" || !VOICE_CATALOG.languages.includes(app)) {
        return { text: english(marked), lang: "en" };
      }
      return { text: m(marked), lang: app };
    },
    speakable: () => ({
      codeLine: m(msg("There is code on screen.")),
      tableLine: m(msg("There is a table on screen.")),
      linkWord: m(msg("a link", { $context: "said aloud in place of a web address" })),
    }),
    settle: () => announceAndWait(m(msg("Voice mode"))),
    keepAwake: () => {
      const activation = activateKeepAwakeAsync("voice-mode");
      void activation.catch(() => {});
      return () => void activation.then(() => deactivateKeepAwake("voice-mode")).catch(() => {});
    },
    onTakenAway: (callback) => {
      const subscriptions = [
        speech.addListener("interrupted", callback),
        speech.addListener("error", callback),
      ];
      const stopWatching = watchLeftApp(callback);
      return () => {
        stopWatching();
        for (const subscription of subscriptions) subscription.remove();
      };
    },
    onHeadsetButton: (callback) => {
      speech.listenForHeadsetButton(true);
      const subscription = speech.addListener("headsetButton", callback);
      return () => {
        subscription.remove();
        speech.listenForHeadsetButton(false);
      };
    },
    reportError: (reason) => {
      if (reason === "microphone") {
        Dialog.alert(
          m(msg("Microphone access is off")),
          m(msg("Allow the microphone in Settings to talk with your assistant.")),
        );
      } else Dialog.alert(m(msg("Voice mode stopped")), m(msg("Try again.")));
    },
    setTimer: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
  });
}

/** Talking with the assistant, on a phone whose build carries the voice; null elsewhere. */
export const voiceMode = create();

export const voiceModeChatKey = (chat: VoiceModeChat) =>
  scopedThreadKey(chat.environmentId, chat.threadId);

/** A chat's composer is on screen and can send for a conversation; returns its detach. */
export function attachVoiceModeChat(chat: VoiceModeChat, host: VoiceModeHost): () => void {
  if (!voiceMode) return () => {};
  const key = voiceModeChatKey(chat);
  chats.set(key, chat);
  return voiceMode.attach(key, host);
}

/** Starts talking in a chat, after the voice's download when it is not on the phone yet. */
export function openVoiceMode(chat: VoiceModeChat, locale: string): void {
  if (!voiceMode || !readAloud) return;
  appLanguage = locale;
  const runtime = voiceMode;
  void readAloud.whenVoiceReady(() => void runtime.open(voiceModeChatKey(chat)));
}
