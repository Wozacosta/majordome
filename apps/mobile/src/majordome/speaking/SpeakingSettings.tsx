import { useNavigation } from "@react-navigation/native";
import { voiceDownloadMegabytes } from "@t3tools/client-runtime/speaking/voice-catalog";
import { useGT, useLocale } from "gt-react-native";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { readAloud, setReadAloudAppLanguage } from "./platform";

const noSubscription = () => () => {};
const ABSENT = { status: "absent" } as const;

/** The voice that reads replies aloud: which one, and removing its download. */
export function SpeakingSettings() {
  const gt = useGT();
  const locale = useLocale();
  const navigation = useNavigation();
  const state = useSyncExternalStore(
    readAloud?.store.subscribe ?? noSubscription,
    () => readAloud?.store.getState() ?? ABSENT,
  );
  const chosen = useSyncExternalStore(
    readAloud?.subscribeVoice ?? noSubscription,
    () => readAloud?.getVoice() ?? 0,
  );
  const sampling = useSyncExternalStore(readAloud?.controller.subscribe ?? noSubscription, () => {
    const speaking = readAloud?.controller.getState();
    return speaking && speaking.status !== "idle" ? speaking.key : null;
  });
  const [voices, setVoices] = useState(0);
  const ready = state.status === "ready";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the files on the phone say whether the voice is there; a sample stops when the screen closes
  useEffect(() => {
    void readAloud?.store.refresh();
    return () => readAloud?.controller.stop();
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- only the loaded voice knows how many voices its file holds
  useEffect(() => {
    if (!ready) return;
    let current = true;
    void readAloud?.voiceCount().then(
      (count) => current && setVoices(count),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [ready]);

  if (!readAloud) return null;
  const megabytes = voiceDownloadMegabytes();

  if (!ready) {
    return (
      <SettingsSection title={gt("Speaking")}>
        <ListActionRow
          icon="arrow.down.circle"
          label={gt("Download the voice ({megabytes} MB)", { megabytes })}
          loading={state.status === "downloading"}
          onPress={() => navigation.navigate("VoiceDownload")}
        />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title={gt("Speaking")}>
      {Array.from({ length: voices }, (_, voice) => {
        const key = `voice:${voice}`;
        const label = gt("Voice {number}", { number: voice + 1 });
        return (
          <ListChoiceRow
            key={voice}
            label={label}
            selected={voice === chosen}
            separated={voice > 0}
            onPress={() => readAloud?.setVoice(voice)}
            leading={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  sampling === key
                    ? gt("Stop", { $context: "stop reading aloud" })
                    : gt("Listen to {voice}", { voice: label })
                }
                hitSlop={10}
                className="size-8 items-center justify-center active:opacity-50"
                onPress={() => {
                  setReadAloudAppLanguage(locale);
                  void readAloud?.controller.toggle({
                    key,
                    voice,
                    markdown: gt("Hello. This is how I sound when I read a reply to you."),
                  });
                }}
              >
                <SymbolView
                  name={sampling === key ? "stop.fill" : "play"}
                  size={14}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                />
              </Pressable>
            }
          />
        );
      })}
      <ListActionRow
        icon="trash"
        tone="danger"
        label={gt("Remove the download")}
        onPress={() =>
          Dialog.confirm({
            title: gt("Remove the voice?"),
            message: gt("Reading aloud will ask to download it again."),
            confirmText: gt("Remove"),
            onConfirm: () => void readAloud?.remove(),
          })
        }
      />
    </SettingsSection>
  );
}
