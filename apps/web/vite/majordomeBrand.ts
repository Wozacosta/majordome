// Majordome is upstream's app under another name. Upstream's source and catalogs keep saying
// "T3 Code", so a merge never conflicts on the name; this swaps it as the web client is built.
import { hashSource } from "generaltranslation/id";
import type { Plugin } from "vite-plus";

import { WORDING } from "./wording/index";
import english from "../src/i18n/translations/en.json" with { type: "json" };

const UPSTREAM_NAME = "T3 Code";
const MAJORDOME_NAME = "Majordome";

const SOURCE = /\/(?:apps\/web\/src|packages\/(?:client-runtime|shared)\/src)\/.*\.tsx?$/;
const CATALOG = /\/apps\/web\/src\/i18n\/translations\/([^/]+)\.json$/;
// These name upstream on purpose.
const KEEPS_UPSTREAM_NAME = /\/packages\/shared\/src\/majordome\.ts$/;

type Catalog = Readonly<Record<string, unknown>>;

const rebrand = (text: string) => text.replaceAll(UPSTREAM_NAME, MAJORDOME_NAME);

/** Upstream's text as Majordome shows it: its own wording for the whole text, then its name. */
const reworded = (text: string, wording: ReadonlyMap<string, string>) =>
  rebrand(wording.get(text) ?? text);

const rewordedValue = (value: unknown, wording: ReadonlyMap<string, string>): unknown =>
  typeof value === "string"
    ? reworded(value, wording)
    : (JSON.parse(rebrand(JSON.stringify(value))) as unknown);

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const longestWord = (text: string) =>
  text
    .split(/[^\p{L}]+/u)
    .reduce((longest, word) => (word.length > longest.length ? word : longest), "");

const literal = (text: string, quote: string) =>
  quote + text.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`) + quote;

interface Swap {
  /** Nearly every file holds none of a text's words, and looking for one is far cheaper. */
  readonly probe: string;
  readonly literals: ReadonlyArray<readonly [upstream: string, majordome: string]>;
  readonly betweenTags: RegExp;
  readonly majordome: string;
}

const swaps = new WeakMap<ReadonlyMap<string, string>, ReadonlyArray<Swap>>();

function swapsOf(wording: ReadonlyMap<string, string>): ReadonlyArray<Swap> {
  const known = swaps.get(wording);
  if (known !== undefined) return known;
  const made = [...wording].map(([upstream, majordome]) => ({
    probe: longestWord(upstream),
    literals: ['"', "'", "`"].map(
      (quote) => [literal(upstream, quote), literal(majordome, quote)] as const,
    ),
    // Between tags, source may wrap a text over lines; the catalog holds it on one.
    betweenTags: new RegExp(`>(\\s*)${upstream.split(" ").map(escaped).join("\\s+")}(\\s*)</`, "g"),
    majordome,
  }));
  swaps.set(wording, made);
  return made;
}

/**
 * Swaps whole texts only, where source spells one out: a quoted string or the text between two
 * tags. A text inside a longer one stays, so a short entry cannot bend an unrelated sentence.
 */
export function rewordSource(code: string, wording: ReadonlyMap<string, string>): string {
  let next = code;
  for (const { probe, literals, betweenTags, majordome } of swapsOf(wording)) {
    if (!next.includes(probe)) continue;
    for (const [from, to] of literals) next = next.replaceAll(from, to);
    next = next.replace(
      betweenTags,
      (_match, before: string, after: string) => `>${before}${majordome}${after}</`,
    );
  }
  return rebrand(next);
}

/**
 * Catalog keys are hashes of the English text, which the swap changes. For each English entry
 * the swap touches, this finds the key its new text gets. An entry whose key cannot be
 * recomputed from its text alone (it carries a context) is left out and renders in English.
 */
export function renamedKeys(
  english: Catalog,
  wording: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const [key, source] of Object.entries(english)) {
    const next = rewordedValue(source, wording);
    if (JSON.stringify(next) === JSON.stringify(source)) continue;
    for (const dataFormat of ["ICU", "JSX", "STRING"] as const) {
      const hash = (value: unknown) => hashSource({ source: value as never, dataFormat });
      if (hash(source) !== key) continue;
      keys.set(key, hash(next));
      break;
    }
  }
  return keys;
}

/**
 * A locale's catalog with upstream's name swapped, findable under the new texts' keys. A reworded
 * text keeps upstream's translation in other languages, which is closer than English.
 */
export function rebrandCatalog(catalog: Catalog, keys: ReadonlyMap<string, string>): Catalog {
  const renamed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(catalog)) {
    const next = JSON.parse(rebrand(JSON.stringify(value))) as unknown;
    renamed[key] = next;
    const renamedKey = keys.get(key);
    // A new text that upstream already has keeps upstream's own translation.
    if (renamedKey !== undefined && !(renamedKey in catalog)) renamed[renamedKey] = next;
  }
  return renamed;
}

export function majordomeBrandPlugin(): Plugin {
  let keys: ReadonlyMap<string, string> | undefined;
  return {
    name: "majordome:brand",
    enforce: "pre",
    transform(code, id) {
      const path = id.split("?")[0] ?? id;
      const catalog = CATALOG.exec(path);
      if (catalog !== null) {
        keys ??= renamedKeys(english, WORDING);
        return {
          code: JSON.stringify(rebrandCatalog(JSON.parse(code) as Catalog, keys)),
          map: null,
        };
      }
      if (!SOURCE.test(path) || KEEPS_UPSTREAM_NAME.test(path)) return null;
      const next = rewordSource(code, WORDING);
      return next === code ? null : { code: next, map: null };
    },
  };
}
