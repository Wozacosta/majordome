import { Atom } from "effect/reactivity";

import { localVoiceTranscriberAtom } from "../../features/voice-input/VoiceInputProvider";
import { voiceRouteAtom } from "../../features/voice-input/voiceDestination";
import { majordomeSpeech } from "../../native/majordomeSpeech";

/**
 * Development only: a simulator has no transcription, so voice mode is offered anyway and its
 * turns are typed in with `majordome-dev://expo-sharing?voice-say=<words>` (see `platform.ts`).
 */
export const DEV_EARS =
  typeof __DEV__ !== "undefined" &&
  __DEV__ &&
  process.env.EXPO_PUBLIC_MAJORDOME_VOICE_DEV_EARS === "1";

/**
 * Talking needs a voice and somewhere to transcribe: the phone itself, or the computer or
 * cloud model the user chose for voice input. A phone with neither does not offer it.
 */
export const voiceModeAvailableAtom = Atom.make((get) => {
  if (!majordomeSpeech) return false;
  if (DEV_EARS) return true;
  const route = get(voiceRouteAtom);
  if (route) return route.transcriber !== null;
  const local = get(localVoiceTranscriberAtom);
  return local !== null && local !== "checking";
}).pipe(Atom.keepAlive, Atom.withLabel("majordome:voice-mode:available"));
