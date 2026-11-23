// Majordome is upstream's app under another name. Upstream's source and catalogs keep saying
// "T3 Code", so a merge never conflicts on the name; this swaps it as the web client is built.
import type { Plugin } from "vite-plus";

import { type Catalog, rebrandCatalog, renamedKeys, rewordSource } from "./majordomeReword.ts";
import { WORDING } from "./wording/index.ts";
import english from "../src/i18n/translations/en.json" with { type: "json" };

export { rebrandCatalog, renamedKeys, rewordSource };

const SOURCE = /\/(?:apps\/web\/src|packages\/(?:client-runtime|shared)\/src)\/.*\.tsx?$/;
const CATALOG = /\/apps\/web\/src\/i18n\/translations\/([^/]+)\.json$/;
// These name upstream on purpose.
const KEEPS_UPSTREAM_NAME = /\/packages\/shared\/src\/majordome\.ts$/;

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
