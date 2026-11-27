import catalog from "./voiceCatalog.json" with { type: "json" };

export interface VoiceFile {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
}

/** The files one on-device voice is made of, and where they are fetched from. */
export interface VoiceCatalog {
  /** Changes whenever a file does, so a new set never mixes with an old one. */
  readonly id: string;
  readonly name: string;
  /** Each file is at `${baseUrl}/${name}`; the host must answer range requests. */
  readonly baseUrl: string;
  readonly license: string;
  readonly copyright: string;
  readonly languages: ReadonlyArray<string>;
  readonly files: ReadonlyArray<VoiceFile>;
}

export const VOICE_CATALOG: VoiceCatalog = catalog;

function voiceDownloadBytes(voice: VoiceCatalog = VOICE_CATALOG): number {
  return voice.files.reduce((total, file) => total + file.size, 0);
}

/** The size the download prompt states, in whole megabytes. */
export function voiceDownloadMegabytes(voice: VoiceCatalog = VOICE_CATALOG): number {
  return Math.round(voiceDownloadBytes(voice) / 1_000_000);
}
