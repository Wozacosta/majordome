/**
 * Which language a reply is read in. The voice needs to be told; a reply is
 * usually in one language, and not always the app's.
 */

const SCRIPTS: ReadonlyArray<readonly [language: string, letters: RegExp]> = [
  ["ko", /[가-힯ᄀ-ᇿ]/g],
  ["ja", /[぀-ヿ]/g],
  ["ar", /[؀-ۿ]/g],
  ["hi", /[ऀ-ॿ]/g],
  ["el", /[Ͱ-Ͽ]/g],
];

const CYRILLIC = /[Ѐ-ӿ]/g;
const UKRAINIAN_ONLY = /[іїєґ]/i;
const BULGARIAN_HINT = /ъ[^\s]|\b(и|на|за|от|се|да|че|това|със)\b/giu;
const RUSSIAN_ONLY = /[ыэё]/i;

// The commonest short words of each language that its neighbours do not share.
const WORDS: Readonly<Record<string, string>> = {
  en: "the and is are was of to in that it you for with this have not be on as at",
  fr: "le la les des est et un une du dans que qui pour pas vous nous sur avec ce cette au aux être sont",
  es: "el los las es y un una del que en por para con no se su está como más pero",
  de: "der die das und ist nicht ein eine ich sie mit für auf dem den zu von auch sich wir",
  it: "il lo gli è e un una di che per non con sono della nel più anche come questo",
  pt: "o os as é e um uma do da que em para não com são mais como você isso está",
  nl: "de het een en is niet van dat ik je voor met op zijn deze ook maar naar",
  sv: "och det är en ett som att inte för med på jag har den till av du",
  da: "og det er en et som at ikke for med på jeg har den til af du",
  pl: "i w nie się na to jest że z do jak ale dla czy tak są",
  cs: "a je se na to že v s ale jsem jako pro tak by jsou",
  ro: "și este un o de la în cu nu să care pe pentru mai sunt",
  tr: "ve bir bu için ile de da değil çok var gibi ama daha ne",
  id: "dan yang di ini itu dengan untuk tidak dari ada akan saya anda",
  fi: "ja on ei se että en oli mutta kun niin tai myös",
  hu: "és a az hogy nem egy is van de ez meg csak",
  vi: "và là của có không một những được trong cho người này",
};

const LATIN_WORDS = new Map<string, ReadonlyArray<string>>();
for (const [language, words] of Object.entries(WORDS)) {
  for (const word of words.split(" ")) {
    LATIN_WORDS.set(word, [...(LATIN_WORDS.get(word) ?? []), language]);
  }
}

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

/** The language of `text` among `supported`, or null when it cannot tell. */
export function detectSpeechLanguage(
  text: string,
  supported: ReadonlyArray<string>,
): string | null {
  const letters = count(text, /\p{L}/gu);
  if (letters === 0) return null;
  const allowed = (language: string) => (supported.includes(language) ? language : null);

  for (const [language, pattern] of SCRIPTS) {
    if (count(text, pattern) / letters > 0.3) return allowed(language);
  }
  if (count(text, CYRILLIC) / letters > 0.5) {
    if (UKRAINIAN_ONLY.test(text)) return allowed("uk");
    if (!RUSSIAN_ONLY.test(text) && count(text, BULGARIAN_HINT) > 2) return allowed("bg");
    return allowed("ru");
  }

  const scores = new Map<string, number>();
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    const languages = LATIN_WORDS.get(word);
    if (!languages) continue;
    // A word several languages share says less about each of them.
    for (const language of languages) {
      scores.set(language, (scores.get(language) ?? 0) + 1 / languages.length);
    }
  }
  const ranked = [...scores].filter(([language]) => supported.includes(language));
  ranked.sort((left, right) => right[1] - left[1]);
  const [best, second] = ranked;
  // One stray word decides nothing, and neither does a near tie.
  if (!best || best[1] < 1.5 || (second && best[1] < second[1] * 1.2)) return null;
  return best[0];
}

/** The language to read `text` in: its own when that is clear, else the app's, else English. */
export function pickSpeechLanguage(
  text: string,
  appLanguage: string,
  supported: ReadonlyArray<string>,
): string {
  const detected = detectSpeechLanguage(text, supported);
  if (detected) return detected;
  const app = appLanguage.toLowerCase().split(/[-_]/)[0] ?? "";
  if (supported.includes(app)) return app;
  return supported.includes("en") ? "en" : (supported[0] ?? "en");
}
