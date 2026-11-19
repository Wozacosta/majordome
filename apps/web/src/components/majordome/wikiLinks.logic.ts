import { ComposerContextId, type ProjectEntry } from "@t3tools/contracts";
import { formatComposerContextHref } from "@t3tools/shared/composerContextReferences";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/mediaPreview";

import { isHiddenVaultPath } from "./notes.logic";

/** The context-link kind a rewritten `[[link]]` renders through; its id indexes `wikiLinkTargets`. */
export const WIKI_LINK_KIND = "vault-note";

// `[[target#heading|alias]]` and `![[embed]]`. A table writes the alias bar as `\|`.
const WIKI_LINK = /(!?)\[\[([^[\]\n]+)\]\]/g;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;

interface WikiLink {
  readonly embed: boolean;
  readonly target: string;
  readonly label: string;
}

function parseWikiLink(embed: boolean, inner: string): WikiLink {
  const bar = /\\?\|/.exec(inner);
  const reference = bar === null ? inner : inner.slice(0, bar.index);
  const alias = bar === null ? "" : inner.slice(bar.index + bar[0].length).trim();
  const hash = reference.indexOf("#");
  const target = (hash === -1 ? reference : reference.slice(0, hash)).trim();
  const subpath =
    hash === -1
      ? ""
      : reference
          .slice(hash + 1)
          .replace(/^\^/, "")
          .trim();
  const written = target && subpath ? `${target} > ${subpath}` : target || subpath;
  return { embed, target, label: alias && !embed ? alias : written };
}

/** Applies `map` to the text outside fenced code blocks and inline code spans. */
function mapOutsideCode(text: string, map: (prose: string) => string): string {
  const mapProse = (prose: string) => {
    let out = "";
    let last = 0;
    for (const code of prose.matchAll(INLINE_CODE)) {
      out += map(prose.slice(last, code.index)) + code[0];
      last = code.index + code[0].length;
    }
    return out + map(prose.slice(last));
  };
  let out = "";
  let prose = "";
  let fence: string | null = null;
  for (const line of text.split(/(?<=\n)/)) {
    const marker = FENCE_LINE.exec(line)?.[1];
    if (fence === null) {
      if (marker === undefined) {
        prose += line;
        continue;
      }
      out += mapProse(prose) + line;
      prose = "";
      fence = marker;
    } else {
      out += line;
      if (
        marker !== undefined &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker
      ) {
        fence = null;
      }
    }
  }
  return out + mapProse(prose);
}

function forEachWikiLink(text: string, visit: (link: WikiLink) => void): void {
  mapOutsideCode(text, (prose) => {
    for (const match of prose.matchAll(WIKI_LINK))
      visit(parseWikiLink(match[1] === "!", match[2]!));
    return prose;
  });
}

/** Every note or file a note links to or embeds the Obsidian way, once each, in reading order. */
export function wikiLinkTargets(text: string): ReadonlyArray<string> {
  const targets = new Set<string>();
  forEachWikiLink(text, (link) => {
    if (link.target !== "") targets.add(link.target);
  });
  return [...targets];
}

/** The name to search the vault for to resolve a link target: its last path segment. */
export function wikiSearchName(target: string): string {
  return target.replaceAll("\\", "/").split("/").at(-1) ?? target;
}

const escapeMarkdown = (text: string) => text.replaceAll(/[!-/:-@[-`{-~]/g, "\\$&");

/**
 * Rewrites `[[links]]` and `![[embeds]]` outside code as standard markdown: an embedded image at
 * the path `imagePath` gives becomes an image, every other link a `WIKI_LINK_KIND` context link
 * whose id is the target's index in `wikiLinkTargets`, and a link to a heading of this same note
 * plain text.
 */
export function rewriteWikiLinks(
  text: string,
  imagePath: (target: string) => string | null | undefined,
): string {
  const indexes = new Map(wikiLinkTargets(text).map((target, index) => [target, index]));
  return mapOutsideCode(text, (prose) =>
    prose.replaceAll(WIKI_LINK, (_whole, bang: string, inner: string) => {
      const link = parseWikiLink(bang === "!", inner);
      const index = indexes.get(link.target);
      if (index === undefined) return escapeMarkdown(link.label);
      if (link.embed && isWorkspaceImagePreviewPath(link.target)) {
        const path = imagePath(link.target);
        if (typeof path === "string") {
          return `![${escapeMarkdown(wikiSearchName(link.target))}](<${path}>)`;
        }
      }
      const href = formatComposerContextHref(WIKI_LINK_KIND, ComposerContextId.make(`${index}`));
      return `[${escapeMarkdown(link.label)}](${href})`;
    }),
  );
}

/**
 * Where a task list marker of the rewritten text sits in the note as written. Rewriting changes
 * no line breaks and nothing before a line's marker, so the line and the column carry over.
 */
export function taskMarkerOffsetInSource(
  source: string,
  rewritten: string,
  markerOffset: number,
): number {
  const before = rewritten.slice(0, markerOffset);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.split("\n").length - 1;
  const sourceLineStart = source.split("\n").slice(0, line).join("\n").length + (line > 0 ? 1 : 0);
  return sourceLineStart + (markerOffset - lineStart);
}

/**
 * Where Obsidian finds a link's target among the vault's files: the exact path from the vault's
 * top first, otherwise the files whose path ends with it (a bare name matches anywhere), the
 * shortest path winning. Names are matched as written and with `.md`, ignoring case. Null when
 * nothing matches.
 */
export function resolveWikiTarget(
  target: string,
  entries: ReadonlyArray<ProjectEntry>,
): string | null {
  const wanted = target
    .trim()
    .replaceAll("\\", "/")
    .replace(/^(?:\.?\/)+/, "");
  if (wanted === "") return null;
  const files = entries.filter((entry) => entry.kind === "file" && !isHiddenVaultPath(entry.path));
  const names = (/\.md$/i.test(wanted) ? [wanted] : [wanted, `${wanted}.md`]).map((name) =>
    name.toLowerCase(),
  );
  for (const name of names) {
    const exact = files.find((file) => file.path.toLowerCase() === name);
    if (exact) return exact.path;
  }
  for (const name of names) {
    const matches = files.filter((file) => file.path.toLowerCase().endsWith(`/${name}`));
    const shortest = matches.toSorted(
      (left, right) => left.path.length - right.path.length || left.path.localeCompare(right.path),
    )[0];
    if (shortest) return shortest.path;
  }
  return null;
}
