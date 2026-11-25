// A swapped text that code also uses as a name, a key or a stored value breaks the app without
// a type error: the route "Thread" once became "Chat" and no chat opened. These tests read the
// source the way the bundler does and fail when a swap reaches such a text.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { rewordSource } from "../../web/vite/majordomeReword.ts";
import { MOBILE_KEPT, MOBILE_WORDING } from "./wording.mts";

const { majordomeWords } = NodeModule.createRequire(import.meta.url)("./words.cjs") as {
  majordomeWords: (text: string) => string;
};

const repoRoot = NodePath.resolve(import.meta.dirname, "../../..");
const read = (file: string) => NodeFS.readFileSync(NodePath.join(repoRoot, file), "utf8");

// The same table metroTransformer.cjs builds.
const english = JSON.parse(read("apps/mobile/src/i18n/translations/en.json")) as Record<
  string,
  unknown
>;
const wording = new Map<string, string>();
for (const text of Object.values(english)) {
  if (typeof text !== "string" || !text.includes(" ")) continue;
  const next = majordomeWords(text);
  if (next !== text) wording.set(text, next);
}
for (const [upstream, majordome] of MOBILE_WORDING) wording.set(upstream, majordome);

const swapped = (text: string) =>
  rewordSource(JSON.stringify(text), wording) !== JSON.stringify(text);

function sourceFiles(directory: string): string[] {
  return NodeFS.readdirSync(NodePath.join(repoRoot, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(file);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
    },
  );
}

// What the bundler rewrites, less the one file it skips.
const SOURCES = ["apps/mobile/src", "packages/client-runtime/src", "packages/shared/src"].flatMap(
  sourceFiles,
);

const sources = new Map(
  SOURCES.filter((file) => file !== "packages/shared/src/majordome.ts").map((file) => [
    file,
    read(file),
  ]),
);

describe("names the app finds things by", () => {
  const stack = read("apps/mobile/src/Stack.tsx");
  const routes = new Set<string>();
  for (const [, name] of stack.matchAll(/^\s+(\w+): createNativeStackScreen\(/gm)) {
    routes.add(name!);
  }
  for (const source of sources.values()) {
    for (const [, name] of source.matchAll(
      /\b(?:navigate|push|replace|popTo|navigateDeprecated)\(\s*"(\w+)"/g,
    )) {
      routes.add(name!);
    }
    for (const [, name] of source.matchAll(/\bname: "([A-Z]\w+)"/g)) routes.add(name!);
  }

  it("finds the navigator's routes", () => {
    expect(routes.size).toBeGreaterThan(80);
    expect(routes).toContain("Thread");
    expect(routes).toContain("SettingsEnvironmentDetail");
  });

  it("keeps every route name", () => {
    expect([...routes].filter(swapped)).toEqual([]);
  });

  it("keeps the tab keys and the values stored on the computer", () => {
    const stored = [
      ...MOBILE_KEPT.map(([upstream]) => upstream),
      "threads",
      "usage",
      "pullRequests",
      "issues",
      "settings",
      "Home",
      "Settings",
      "Thread",
    ];
    expect(stored.filter(swapped)).toEqual([]);
  });

  it("keeps the parts tool names and sentences are keyed by", () => {
    const presentation = read("packages/shared/src/t3McpToolPresentation.ts");
    const labels = [...presentation.matchAll(/tool\(\s*\[([^\]]+)\]/g)].flatMap(([, list]) =>
      [...list!.matchAll(/"([^"]+)"/g)].map(([, label]) => label!),
    );
    expect(labels.length).toBeGreaterThan(200);
    expect(labels.filter(swapped)).toEqual([]);

    const names = read("packages/shared/src/t3McpToolPresentationCopy.ts");
    const keys = [...names.matchAll(/\[\s*"([^"]+)",\s*msg\(/g)].map(([, key]) => key!);
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.filter(swapped)).toEqual([]);
  });
});

const literal = (text: string, quote: string) =>
  quote + text.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`) + quote;

const longestWord = (text: string) =>
  text
    .split(/[^\p{L}]+/u)
    .reduce((longest, word) => (word.length > longest.length ? word : longest), "");

/** Swapped texts spelled outside a translation call: `file: text`, comments left out. */
function swapsOutsideTranslation(): string[] {
  const swaps = [...wording]
    .filter(([upstream, majordome]) => upstream !== majordome)
    .map(([upstream]) => ({
      upstream,
      probe: longestWord(upstream),
      literals: ['"', "'", "`"].map((quote) => literal(upstream, quote)),
    }));
  const found = new Set<string>();
  for (const [file, source] of sources) {
    for (const { upstream, probe, literals } of swaps) {
      if (!source.includes(probe)) continue;
      for (const spelled of literals) {
        let at = source.indexOf(spelled);
        while (at !== -1) {
          const lineStart = source.lastIndexOf("\n", at) + 1;
          const comment = /^\s*(?:\/\/|\/?\*)/.test(source.slice(lineStart, at));
          const translated = /\b(?:gt|msg|m|t)\(\s*$/.test(source.slice(Math.max(0, at - 200), at));
          if (!comment && !translated) found.add(`${file}: ${upstream}`);
          at = source.indexOf(spelled, at + 1);
        }
      }
    }
  }
  return [...found].sort();
}

// Each was read and is text someone sees, or a value every site of which is swapped together.
// A new line here means a swap reached a literal outside gt/msg/m/t: check it is not a key, a
// route, a comparison with something the computer sends, or a stored value. If it is, list the
// text in MOBILE_KEPT or narrow the rule instead of adding it here.
const REVIEWED = [
  // A row label in the developer's component catalog.
  "apps/mobile/src/features/development/ComponentCatalogScreen.tsx: Projects",
  // A union local to the phone's undo notice; its three files are swapped together.
  "apps/mobile/src/features/home/HomeScreen.tsx: this environment",
  "apps/mobile/src/features/home/ThreadUndoNotice.tsx: Settled",
  "apps/mobile/src/features/home/thread-undo-notice.ts: Settled",
  "apps/mobile/src/features/home/useThreadListActions.ts: Settled",
  // The site the legal pages open from; the allowlist is built from the same value.
  "apps/mobile/src/features/settings/lib/legal-document-url.ts: https://t3.codes",
  // Fallback texts of the home-screen widget.
  "apps/mobile/src/widgets/AgentActivity.tsx: Agent status out of date",
  "apps/mobile/src/widgets/AgentActivity.tsx: Agent work completed",
  "apps/mobile/src/widgets/AgentActivity.tsx: Agent work failed",
  "apps/mobile/src/widgets/AgentActivityWidget.tsx: No active agents",
  // Error messages, shown and never compared.
  "packages/client-runtime/src/state/attachments.ts: The environment is not connected.",
  "packages/client-runtime/src/state/peerPairingCode.ts: The environment is not connected.",
];

describe("swapped texts outside a translation call", () => {
  it("are the reviewed ones only", () => {
    expect(swapsOutsideTranslation()).toEqual([...REVIEWED].sort());
  });
});

describe("the phone's wording table", () => {
  it("lists only texts upstream still has", () => {
    const upstreamTexts = new Set(Object.values(english));
    const everySource = [...sources.values()].join("\n");
    const gone = MOBILE_WORDING.map(([upstream]) => upstream).filter(
      (upstream) => !upstreamTexts.has(upstream) && !everySource.includes(upstream),
    );
    expect(gone).toEqual([]);
  });

  it("lists a text once", () => {
    const seen = new Set<string>();
    const twice = MOBILE_WORDING.filter(([upstream]) => {
      if (seen.has(upstream)) return true;
      seen.add(upstream);
      return false;
    });
    expect(twice).toEqual([]);
  });
});
