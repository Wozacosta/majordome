/**
 * The words of the notes search: which files of a vault are notes, what is indexed of each, how
 * what the owner types becomes a full-text query, and how a result's snippet is cut.
 */

/** Text a person writes notes in. Data files, canvases and everything binary stay out. */
const NOTE_EXTENSIONS = new Set(["md", "markdown", "mdx", "txt", "org"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

/** A note longer than this is an export or a log, and would crowd every search. */
export const NOTE_MAX_BYTES = 1024 * 1024;

/** `.git`, `.majordome`, `.obsidian`, `.trash` and installed packages, as Notes hides them. */
export const isSkippedEntry = (name: string) => name.startsWith(".") || name === "node_modules";

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

export const isNoteFile = (name: string) => NOTE_EXTENSIONS.has(extensionOf(name));

export const isMarkdownFile = (name: string) => MARKDOWN_EXTENSIONS.has(extensionOf(name));

export interface NoteHeading {
  /** Where the heading's line starts in the body, in characters as SQLite counts them. */
  readonly offset: number;
  readonly text: string;
}

export interface IndexedNote {
  readonly title: string;
  readonly headings: ReadonlyArray<NoteHeading>;
  /** `headings` as the index stores them beside the note, to name the heading a match is under. */
  readonly headingsJson: string;
  readonly body: string;
}

const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
// The snippet marks are control characters, so a note must hold none; tab and newlines stay.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*\r?$/;
const FENCE = /^ {0,3}(?:```|~~~)/;

/** Null for a file that is not text. */
export function readNote(relativePath: string, text: string): IndexedNote | null {
  if (text.includes("\u0000")) return null;
  const body = text.replace(/^﻿/, "").replace(CONTROL_CHARACTERS, " ");
  const name = relativePath.split("/").at(-1) ?? relativePath;
  const headings: Array<NoteHeading> = [];
  if (MARKDOWN_EXTENSIONS.has(extensionOf(name))) {
    let offset = 0;
    let fenced = false;
    for (const line of body.split("\n")) {
      if (FENCE.test(line)) fenced = !fenced;
      else if (!fenced) {
        const heading = HEADING.exec(line)?.[1]?.trim();
        if (heading) headings.push({ offset, text: heading });
      }
      offset += line.length - (line.match(SURROGATE_PAIR)?.length ?? 0) + 1;
    }
  }
  const dot = name.lastIndexOf(".");
  return {
    title: headings[0]?.text ?? (dot <= 0 ? name : name.slice(0, dot)),
    headings,
    headingsJson: JSON.stringify(headings),
    body,
  };
}

const QUERY_PART = /"([^"]*)"?|(\S+)/g;
const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u;
const MAX_QUERY_PARTS = 16;

/**
 * The FTS5 query for what was typed, or null when it holds no word. Every part is a quoted
 * string, so FTS5 reads none of it as syntax; all parts must match; "quoted words" match as a
 * phrase; the last word, when it is not quoted, matches as a prefix because it may be unfinished.
 */
export function notesMatchQuery(query: string): string | null {
  const parts: Array<{ readonly text: string; readonly phrase: boolean }> = [];
  for (const match of query.matchAll(QUERY_PART)) {
    const text = match[1] ?? match[2] ?? "";
    if (HAS_WORD_CHARACTER.test(text)) parts.push({ text, phrase: match[1] !== undefined });
  }
  if (parts.length === 0) return null;
  return parts
    .slice(0, MAX_QUERY_PARTS)
    .map((part, index, all) => {
      const quoted = `"${part.text.replaceAll('"', '""')}"`;
      return index === all.length - 1 && !part.phrase ? `${quoted}*` : quoted;
    })
    .join(" ");
}

/** A vault-relative folder as the index stores paths, or null for the whole vault. */
export function normalizeFolder(folder: string | undefined): string | null {
  const cleaned = (folder ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^(?:\.?\/)+/, "")
    .replace(/\/+$/, "");
  return cleaned === "" || cleaned === "." ? null : cleaned;
}

export const MATCH_START = "\u0001";
export const MATCH_END = "\u0002";
/** How much text before the first match a snippet's window holds. */
export const SNIPPET_LEAD = 60;
/** The window read from the index for one snippet, marks and markdown included. */
export const SNIPPET_WINDOW = 480;
export const SNIPPET_LENGTH = 200;

export interface NoteSnippet {
  readonly snippet: string;
  readonly highlights: ReadonlyArray<{ readonly start: number; readonly end: number }>;
}

/**
 * One line of readable text from a window of a note whose matches sit between `MATCH_START` and
 * `MATCH_END`: heading and emphasis marks dropped, whitespace collapsed, an ellipsis where the
 * note goes on.
 */
export function shapeSnippet(
  window: string,
  cut: { readonly before: boolean; readonly after: boolean },
): NoteSnippet {
  let text = window;
  if (cut.before) {
    // The window starts mid-word; start at the next word that comes before the match.
    const firstBreak = text.search(/\s/);
    const firstMatch = text.indexOf(MATCH_START);
    if (firstBreak !== -1 && (firstMatch === -1 || firstBreak < firstMatch)) {
      text = text.slice(firstBreak + 1);
    }
  }
  text = text
    .replace(/(^|\n)[ \t]*#{1,6}[ \t]+/g, "$1")
    .replace(/\*\*|`+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const lead = cut.before ? "…" : "";
  const highlights: Array<{ start: number; end: number }> = [];
  let snippet = lead;
  let openedAt: number | null = null;
  let truncated = false;
  for (const character of text) {
    if (character === MATCH_START) openedAt = snippet.length;
    else if (character === MATCH_END) {
      if (openedAt !== null && snippet.length > openedAt) {
        highlights.push({ start: openedAt, end: snippet.length });
      }
      openedAt = null;
    } else if (snippet.length - lead.length >= SNIPPET_LENGTH) {
      truncated = true;
      break;
    } else snippet += character;
  }
  if (openedAt !== null && snippet.length > openedAt) {
    highlights.push({ start: openedAt, end: snippet.length });
  }
  return { snippet: cut.after || truncated ? `${snippet.trimEnd()}…` : snippet, highlights };
}

/** The heading a match at `offset` sits under. */
export function headingAt(headings: ReadonlyArray<NoteHeading>, offset: number): string | null {
  let found: string | null = null;
  for (const heading of headings) {
    if (heading.offset > offset) break;
    found = heading.text;
  }
  return found;
}
