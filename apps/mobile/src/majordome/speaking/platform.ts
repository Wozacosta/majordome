import { VOICE_CATALOG } from "@t3tools/client-runtime/speaking/voice-catalog";
import { setIsAudioActiveAsync } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { msg } from "gt-react-native";
import { AccessibilityInfo, AppState, Platform } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { m } from "../../i18n/messages";
import {
  acquireAudioSession,
  activateAudioSession,
  isAudioSessionOwner,
  releaseAudioSession,
} from "../../lib/audioSession";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { majordomeSpeech } from "../../native/majordomeSpeech";
import { createReadAloudRuntime, type ReadAloudRuntime } from "./readAloudRuntime";
import { createVoiceFiles, voiceDirectory } from "./voiceFiles";

let appLanguage = "en";

/** The button tells the runtime which language the app is in; `m()` cannot say. */
export function setReadAloudAppLanguage(locale: string): void {
  appLanguage = locale;
}

const voiceChoice = () => new File(Paths.document, "majordome-voice");

function readVoice(): number {
  try {
    const choice = voiceChoice();
    const voice = choice.exists ? Number.parseInt(choice.textSync(), 10) : 0;
    return Number.isInteger(voice) && voice >= 0 ? voice : 0;
  } catch {
    return 0;
  }
}

async function takeAudio(onTaken: () => void) {
  const token = acquireAudioSession("playback", onTaken, () => {
    // Lets the music this interrupted come back.
    void setIsAudioActiveAsync(false).catch(() => {});
  });
  // A recording keeps the session: dictation is never talked over.
  if (!isAudioSessionOwner(token)) return null;
  const release = () => void releaseAudioSession(token).catch(() => {});
  if (await activateAudioSession(token)) return release;
  release();
  return null;
}

/** With VoiceOver on, says `announcement` first and waits, so two voices never overlap. */
export async function announceAndWait(announcement: string) {
  if (!(await AccessibilityInfo.isScreenReaderEnabled())) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      subscription?.remove();
      clearTimeout(timer);
      resolve();
    };
    const subscription =
      Platform.OS === "ios"
        ? AccessibilityInfo.addEventListener("announcementFinished", (event) => {
            if (event.announcement === announcement) finish();
          })
        : null;
    const timer = setTimeout(finish, Platform.OS === "ios" ? 4_000 : 1_500);
    AccessibilityInfo.announceForAccessibility(announcement);
  });
}

function create(): ReadAloudRuntime | null {
  if (!majordomeSpeech) return null;
  const directory = voiceDirectory(VOICE_CATALOG.id);
  const runtime = createReadAloudRuntime({
    speech: majordomeSpeech,
    catalog: VOICE_CATALOG,
    files: createVoiceFiles(directory, majordomeSpeech.sha256),
    directoryUri: directory.uri,
    takeAudio,
    settle: () => announceAndWait(m(msg("Reading aloud"))),
    openDownload: () => {
      if (rootNavigationRef.isReady()) rootNavigationRef.navigate("VoiceDownload");
    },
    reportError: () => Dialog.alert(m(msg("Could not read this aloud")), m(msg("Try again."))),
    placeholders: () => ({
      codeLine: m(msg("There is code on screen.")),
      tableLine: m(msg("There is a table on screen.")),
      linkWord: m(msg("a link", { $context: "said aloud in place of a web address" })),
    }),
    appLanguage: () => appLanguage,
    readVoice,
    writeVoice: (voice) => {
      try {
        void voiceChoice()
          .write(String(voice))
          .catch(() => {});
      } catch {}
    },
  });
  // iOS silences an app that leaves the screen, and ends one that keeps 300 MB there.
  AppState.addEventListener("change", (state) => {
    if (state === "background") void runtime.suspend();
  });
  return runtime;
}

/** Reading aloud, on a phone whose build carries the voice engine; null elsewhere. */
export const readAloud = create();
