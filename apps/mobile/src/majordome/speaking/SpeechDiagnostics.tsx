import { useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import type { SpeechMeasurement } from "../../native/majordomeSpeech";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { readAloud } from "./platform";
import type { ReadAloudRuntime } from "./readAloudRuntime";

// Fixed, so two builds or two phones are compared on the same words.
const SENTENCES = [
  { lang: "fr", text: "Bonjour, voici un essai de la voix de Majordome sur ce téléphone." },
  { lang: "en", text: "Hello, this is a test of the Majordome voice on this phone." },
] as const;

type Result = { readonly lang: string } & (
  | { readonly measurement: SpeechMeasurement }
  | { readonly error: string }
);

/** Proves the voice on this phone: load time, first sound, speed and peak memory. */
export function SpeechDiagnostics() {
  const gt = useGT();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ReadonlyArray<Result>>([]);
  if (!readAloud) return null;
  const runtime = readAloud;

  const run = async () => {
    setRunning(true);
    setResults([]);
    await measureAll(runtime, gt("Download the voice first."), setResults).catch(() => {});
    setRunning(false);
  };

  return (
    <SettingsSection title={gt("Voice")}>
      <ListActionRow
        icon="speaker.wave.2"
        label={gt("Measure the voice")}
        loading={running}
        onPress={() => void run()}
      />
      {results.map((result) => (
        <View key={result.lang} className="border-t border-border-subtle px-4 py-3">
          <Text selectable className="font-mono text-xs text-foreground-secondary">
            {"error" in result
              ? `${result.lang}: ${result.error}`
              : formatMeasurement(result.lang, result.measurement)}
          </Text>
        </View>
      ))}
    </SettingsSection>
  );
}

async function measureAll(
  runtime: ReadAloudRuntime,
  voiceMissing: string,
  report: (results: ReadonlyArray<Result>) => void,
) {
  if ((await runtime.store.refresh()).status !== "ready") {
    return report([{ lang: "-", error: voiceMissing }]);
  }
  const results: Result[] = [];
  for (const { lang, text } of SENTENCES) {
    try {
      const measurement = await runtime.measure(text, lang);
      results.push({ lang, measurement });
      report([...results]);
      // Lets the sentence finish before the next one reloads the voice.
      await new Promise((resolve) => setTimeout(resolve, measurement.audioMs + 300));
    } catch (error) {
      results.push({ lang, error: error instanceof Error ? error.message : String(error) });
      report([...results]);
    }
  }
}

// English on purpose: figures for a bug report, read by the maintainers.
function formatMeasurement(lang: string, measurement: SpeechMeasurement): string {
  const speed = measurement.audioMs / Math.max(measurement.synthMs, 1);
  return [
    `${lang}: load ${Math.round(measurement.loadMs)} ms`,
    `first sound ${Math.round(measurement.firstAudioMs)} ms`,
    `${speed.toFixed(1)}x real time (${Math.round(measurement.audioMs)} ms of sound in ${Math.round(measurement.synthMs)} ms)`,
    `peak memory ${Math.round(measurement.peakMemoryMb)} MB (${Math.round(measurement.baselineMemoryMb)} MB before the voice)`,
  ].join("\n");
}
