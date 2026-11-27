import catalog from "./voiceCatalog.json" with { type: "json" };

export interface VoiceFile {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  /** Where this file is fetched from, when not from the catalog's `baseUrl`. */
  readonly baseUrl?: string;
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

const { web, ...phone } = catalog;

export const VOICE_CATALOG: VoiceCatalog = phone;

/** The release folders the window fetches from; a host that sends CORS headers. */
const WEB_VOICE_ORIGIN = "https://majord.link/voice";

/**
 * The files the window uses: GitHub's downloads send no CORS header, so they come
 * through `origin`. A graphics card with 16-bit floats gets the fp16 files for the
 * two large models, which run three times faster there than the int8 ones.
 */
export function webVoiceCatalog(
  halfFloats: boolean,
  origin: string = WEB_VOICE_ORIGIN,
): VoiceCatalog {
  const from = (baseUrl: string) => baseUrl.replace(WEB_VOICE_ORIGIN, origin);
  if (!halfFloats) return { ...phone, baseUrl: from(web.baseUrl) };
  const { fp16 } = web;
  return {
    ...phone,
    id: fp16.id,
    baseUrl: from(web.baseUrl),
    files: [
      ...phone.files.filter((file) => !fp16.replaces.includes(file.name)),
      ...fp16.files.map((file) => ({ ...file, baseUrl: from(fp16.baseUrl) })),
    ],
  };
}

function voiceDownloadBytes(voice: VoiceCatalog = VOICE_CATALOG): number {
  return voice.files.reduce((total, file) => total + file.size, 0);
}

/** The size the download prompt states, in whole megabytes. */
export function voiceDownloadMegabytes(voice: VoiceCatalog = VOICE_CATALOG): number {
  return Math.round(voiceDownloadBytes(voice) / 1_000_000);
}
