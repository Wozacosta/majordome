// Majordome is upstream's phone app under another name. Upstream's source and catalogs keep
// saying "T3 Code"; this swaps the name and wording as Metro bundles, like the web build does.
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { majordomeWords } = require("./words.cjs");

const repoRoot = path.resolve(__dirname, "../../..");
const SOURCE = /\/(?:apps\/mobile\/src|packages\/(?:client-runtime|shared)\/src)\/.*\.tsx?$/;
const CATALOG = /\/apps\/mobile\/src\/i18n\/translations\/[^/]+\.json$/;
// These name upstream on purpose.
const KEEPS_UPSTREAM_NAME = /\/packages\/shared\/src\/majordome\.ts$/;

const englishCatalog = path.join(repoRoot, "apps/mobile/src/i18n/translations/en.json");
const rewordModule = path.join(repoRoot, "apps/web/vite/majordomeReword.ts");
const mobileWording = path.join(__dirname, "wording.mts");

let loading;
function load() {
  loading ??= (async () => {
    const load = (file) => import(pathToFileURL(file).href);
    const [reword, mobile] = await Promise.all([load(rewordModule), load(mobileWording)]);
    // Never the web tables: they hold words like "Thread" that are route names here, and a
    // swapped route name stops navigation.
    const english = JSON.parse(fs.readFileSync(englishCatalog, "utf8"));
    const wording = new Map();
    // Every sentence takes Majordome's words. One word alone is left out here, as it may also
    // be a route name; the table lists the safe ones.
    for (const text of Object.values(english)) {
      if (typeof text !== "string" || !text.includes(" ")) continue;
      const next = majordomeWords(text);
      if (next !== text) wording.set(text, next);
    }
    for (const [upstream, majordome] of mobile.MOBILE_WORDING) wording.set(upstream, majordome);
    return { reword, wording, keys: reword.renamedKeys(english, wording) };
  })();
  return loading;
}

async function swapped(file, data) {
  const catalog = CATALOG.test(file);
  if (!catalog && (!SOURCE.test(file) || KEEPS_UPSTREAM_NAME.test(file))) return data;
  const { reword, wording, keys } = await load();
  const text = data.toString("utf8");
  const next = catalog
    ? JSON.stringify(reword.rebrandCatalog(JSON.parse(text), keys))
    : reword.rewordSource(text, wording);
  return next === text ? data : Buffer.from(next, "utf8");
}

exports.transform = async (config, projectRoot, filename, data, options) => {
  const base = require(config.majordomeBaseTransformerPath);
  const file = path.resolve(projectRoot, filename).split(path.sep).join("/");
  return base.transform(config, projectRoot, filename, await swapped(file, data), options);
};
