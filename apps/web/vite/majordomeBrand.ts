// Majordome is upstream's app under another name. Upstream's source and catalogs keep saying
// "T3 Code", so a merge never conflicts on the name; this swaps it as the web client is built.
import { hashSource } from "generaltranslation/id";
import type { Plugin } from "vite-plus";

import english from "../src/i18n/translations/en.json" with { type: "json" };

const UPSTREAM_NAME = "T3 Code";
const MAJORDOME_NAME = "Majordome";

const SOURCE = /\/(?:apps\/web\/src|packages\/(?:client-runtime|shared)\/src)\/.*\.tsx?$/;
const CATALOG = /\/apps\/web\/src\/i18n\/translations\/([^/]+)\.json$/;
// These name upstream on purpose.
const KEEPS_UPSTREAM_NAME = /\/packages\/shared\/src\/majordome\.ts$/;

type Catalog = Readonly<Record<string, unknown>>;

const rebrand = (text: string) => text.replaceAll(UPSTREAM_NAME, MAJORDOME_NAME);

const rebrandValue = (value: unknown): unknown =>
  JSON.parse(rebrand(JSON.stringify(value))) as unknown;

/**
 * Catalog keys are hashes of the English text, which the swap changes. For each English entry
 * that names upstream, this finds the key its renamed text gets. An entry whose key cannot be
 * recomputed from its text alone (it carries a context) is left out and renders in English.
 */
export function renamedKeys(english: Catalog): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const [key, source] of Object.entries(english)) {
    if (!JSON.stringify(source).includes(UPSTREAM_NAME)) continue;
    for (const dataFormat of ["ICU", "JSX", "STRING"] as const) {
      const hash = (value: unknown) => hashSource({ source: value as never, dataFormat });
      if (hash(source) !== key) continue;
      keys.set(key, hash(rebrandValue(source)));
      break;
    }
  }
  return keys;
}

/** A locale's catalog with upstream's name swapped, findable under the renamed text's keys. */
export function rebrandCatalog(catalog: Catalog, keys: ReadonlyMap<string, string>): Catalog {
  const renamed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(catalog)) {
    const next = rebrandValue(value);
    renamed[key] = next;
    const renamedKey = keys.get(key);
    if (renamedKey !== undefined) renamed[renamedKey] = next;
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
        keys ??= renamedKeys(english);
        return {
          code: JSON.stringify(rebrandCatalog(JSON.parse(code) as Catalog, keys)),
          map: null,
        };
      }
      if (!SOURCE.test(path) || KEEPS_UPSTREAM_NAME.test(path) || !code.includes(UPSTREAM_NAME)) {
        return null;
      }
      return { code: rebrand(code), map: null };
    },
  };
}
