const MIN_SENTENCE_CHARS = 12;
const MAX_SENTENCE_CHARS = 300;
const MIN_PIECE_CHARS = 100;
const LONG_TAIL_CHARS = 40;

const TERMINATORS = ".!?…";
const CLOSERS = "\"'»”’)]";

const ABBREVIATIONS = new Set([
  "mme",
  "mmes",
  "mlle",
  "mlles",
  "mm",
  "mr",
  "mrs",
  "ms",
  "dr",
  "drs",
  "pr",
  "prof",
  "me",
  "st",
  "ste",
  "jr",
  "sr",
  "vs",
  "cf",
  "env",
  "av",
  "apr",
  "no",
  "nos",
  "art",
  "vol",
  "fig",
  "pp",
  "éd",
  "ed",
  "tél",
  "tel",
  "approx",
  "ex",
  "e.g",
  "i.e",
  "a.m",
  "p.m",
  "j.-c",
  "n.b",
]);

const WORD_CHAR = /[\p{L}\p{N}.-]/u;
const LOWERCASE = /\p{Ll}/u;
const INITIALS = /^\p{L}(?:\.-?\p{L})*$/u;
const OPENERS = /^["'«“‘([]+/;

function wordBefore(text: string, dotIndex: number): string {
  let start = dotIndex;
  while (start > 0 && WORD_CHAR.test(text.charAt(start - 1))) start -= 1;
  return text.slice(start, dotIndex);
}

function isBoundary(text: string, firstTerminator: number, afterRun: number): boolean {
  if (afterRun >= text.length) return true;
  if (!/\s/.test(text.charAt(afterRun))) return false;
  const rest = text.slice(afterRun).trimStart();
  if (rest === "") return true;
  const run = text.slice(firstTerminator, afterRun);
  if (run.includes("!") || run.includes("?")) return true;
  const nextChar = rest.replace(OPENERS, "").charAt(0);
  if (nextChar === "" || LOWERCASE.test(nextChar)) return false;
  if (run.startsWith("…") || run.startsWith("..")) return true;
  const word = wordBefore(text, firstTerminator);
  if (word === "") return true;
  if (INITIALS.test(word)) return false;
  return !ABBREVIATIONS.has(word.toLowerCase());
}

function splitParagraph(paragraph: string): string[] {
  const text = paragraph.replace(/\s+/g, " ").trim();
  const fragments: string[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    if (!TERMINATORS.includes(text.charAt(index))) {
      index += 1;
      continue;
    }
    const first = index;
    while (index < text.length && TERMINATORS.includes(text.charAt(index))) index += 1;
    while (index < text.length && CLOSERS.includes(text.charAt(index))) index += 1;
    if (/^[ \u00A0\u202F]»/.test(text.slice(index, index + 2))) index += 2;
    if (isBoundary(text, first, index)) {
      const fragment = text.slice(start, index).trim();
      if (fragment !== "") fragments.push(fragment);
      start = index;
    }
  }
  const rest = text.slice(start).trim();
  if (rest !== "") fragments.push(rest);
  return fragments;
}

export interface SentenceUnits {
  readonly units: string[];
  readonly tail: string;
}

export function groupSentences(text: string): SentenceUnits {
  const units: string[] = [];
  let pending = "";
  for (const paragraph of text.split(/\n[ \t]*\n\s*/)) {
    for (const fragment of splitParagraph(paragraph)) {
      pending = pending === "" ? fragment : `${pending} ${fragment}`;
      if (pending.length >= MIN_SENTENCE_CHARS) {
        units.push(pending);
        pending = "";
      }
    }
  }
  return { units, tail: pending };
}

export function splitLongSentence(sentence: string): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_SENTENCE_CHARS) {
    const limit = Math.min(MAX_SENTENCE_CHARS, rest.length - LONG_TAIL_CHARS);
    const window = rest.slice(0, limit);
    let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
    if (cut < MIN_PIECE_CHARS) cut = Math.max(window.lastIndexOf(": "), window.lastIndexOf(" – "));
    if (cut >= MIN_PIECE_CHARS) cut += 1;
    else cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = limit;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest !== "") pieces.push(rest);
  return pieces;
}

export function splitSentences(text: string): string[] {
  const { units, tail } = groupSentences(text);
  if (tail !== "") {
    const last = units.pop();
    units.push(last === undefined ? tail : `${last} ${tail}`);
  }
  return units.flatMap(splitLongSentence);
}
