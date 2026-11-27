export interface EndOfTurnOptions {
  readonly speechDb?: number;
  readonly quietMs?: number;
  readonly minSpeechMs?: number;
  readonly giveUpMs?: number;
}

export interface MicrophoneLevelSample {
  readonly db: number;
  readonly atMs: number;
}

export type EndOfTurnStatus = "waiting" | "speaking" | "ended" | "gave-up";

export interface EndOfTurnDetector {
  push(sample: MicrophoneLevelSample): EndOfTurnStatus;
  reset(): void;
}

const DEFAULT_SPEECH_DB = -40;
const DEFAULT_QUIET_MS = 2000;
const DEFAULT_MIN_SPEECH_MS = 300;
const DEFAULT_GIVE_UP_MS = 30_000;

const SPEECH_ABOVE_FLOOR_DB = 12;
// Someone already talking at the first sample must not become the floor.
const HIGHEST_FLOOR_DB = -35;
const FLOOR_RISE_DB_PER_SECOND = 1.5;
const LONGEST_SAMPLE_GAP_MS = 250;

export function createEndOfTurnDetector(options: EndOfTurnOptions = {}): EndOfTurnDetector {
  const speechDb = options.speechDb ?? DEFAULT_SPEECH_DB;
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
  const minSpeechMs = options.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;
  const giveUpMs = options.giveUpMs ?? DEFAULT_GIVE_UP_MS;

  let status: EndOfTurnStatus = "waiting";
  let startedAtMs: number | null = null;
  let previousAtMs = 0;
  let floorDb = HIGHEST_FLOOR_DB;
  let loudMs = 0;
  let lastLoudAtMs = 0;

  return {
    push({ db, atMs }) {
      if (status === "ended" || status === "gave-up") return status;
      if (!Number.isFinite(atMs)) return status;
      const level = Number.isFinite(db) ? db : -160;
      if (startedAtMs === null) {
        startedAtMs = atMs;
        previousAtMs = atMs;
        floorDb = Math.min(level, HIGHEST_FLOOR_DB);
      }
      const elapsedMs = Math.min(Math.max(atMs - previousAtMs, 0), LONGEST_SAMPLE_GAP_MS);
      previousAtMs = Math.max(previousAtMs, atMs);
      floorDb = Math.min(
        level,
        floorDb + (FLOOR_RISE_DB_PER_SECOND * elapsedMs) / 1000,
        HIGHEST_FLOOR_DB,
      );

      const loud = level >= Math.max(speechDb, floorDb + SPEECH_ABOVE_FLOOR_DB);
      if (loud) {
        loudMs += elapsedMs;
        lastLoudAtMs = atMs;
        if (loudMs >= minSpeechMs) status = "speaking";
      } else if (status === "waiting") {
        loudMs = Math.max(0, loudMs - elapsedMs);
      }

      if (status === "speaking" && atMs - lastLoudAtMs >= quietMs) status = "ended";
      else if (status === "waiting" && atMs - startedAtMs >= giveUpMs) status = "gave-up";
      return status;
    },
    reset() {
      status = "waiting";
      startedAtMs = null;
      previousAtMs = 0;
      floorDb = HIGHEST_FLOOR_DB;
      loudMs = 0;
      lastLoudAtMs = 0;
    },
  };
}
