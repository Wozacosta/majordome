// Upstream's coding words, said the way Majordome says them. Each pair is upstream's exact English
// text and the text Majordome shows instead; one file per area keeps edits from colliding.
import { CHAT_WORDING } from "./chat";
import { LINKS_WORDING } from "./links";
import { ONBOARDING_WORDING } from "./onboarding";
import { SETTINGS_WORDING } from "./settings";

export type Wording = ReadonlyArray<readonly [upstream: string, majordome: string]>;

export const WORDING: ReadonlyMap<string, string> = new Map([
  ...CHAT_WORDING,
  ...LINKS_WORDING,
  ...ONBOARDING_WORDING,
  ...SETTINGS_WORDING,
]);
