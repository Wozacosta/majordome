/**
 * How a note's Markdown source is shown while it is written: the text stays exactly as typed, and
 * each line is given a look plus spans to style, or to hide while the caret is elsewhere.
 */

export type NoteLineBlock =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "quote"
  | "list"
  | "task"
  | "task-done"
  | "rule"
  | "code"
  | "meta";

export type NoteSpanKind =
  /** Markup that is hidden unless the caret is on its line. */
  | "syntax"
  /** A list dash, drawn as a bullet unless the caret is on its line. */
  | "bullet"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "wiki";

export interface NoteSpan {
  readonly from: number;
  readonly to: number;
  readonly kind: NoteSpanKind;
  /** Where a link or wiki link points. */
  readonly target?: string;
}

export interface NoteLine {
  readonly block: NoteLineBlock;
  readonly spans: ReadonlyArray<NoteSpan>;
  /** A checkbox: `at` is the offset of the character between its brackets. */
  readonly task: { readonly at: number; readonly checked: boolean } | null;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})[ \t]+/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const LIST = /^([ \t]*)(?:([-*+])|\d{1,9}[.)])[ \t]+/;
const TASK = /^\[([ xX])\][ \t]+/;
const TABLE = /^[ \t]*\|/;

// One alternative per inline construct; the leftmost match wins and code spans are never entered.
const INLINE = new RegExp(
  [
    "(?<code>(?<tick>`+)(?!`).*?(?<!`)\\k<tick>(?!`))",
    "!?\\[\\[(?<wiki>[^[\\]\\n]+)\\]\\]",
    '!?\\[(?<label>[^\\]\\n]*)\\]\\((?<href><[^>\\n]+>|[^)\\s]+)(?:\\s+"[^"\\n]*")?\\)',
    "\\*\\*(?=\\S)(?<bold>.+?)(?<=\\S)\\*\\*",
    "__(?=\\S)(?<bold2>.+?)(?<=\\S)__",
    "~~(?=\\S)(?<strike>.+?)(?<=\\S)~~",
    "(?<![\\w*\\\\])\\*(?=[^\\s*])(?<italic>.+?)(?<=[^\\s*])\\*(?![\\w*])",
    "(?<![\\w\\\\])_(?=[^\\s_])(?<italic2>.+?)(?<=[^\\s_])_(?!\\w)",
  ].join("|"),
  "g",
);

function inlineSpans(text: string, offset: number, spans: Array<NoteSpan>): void {
  for (const match of text.matchAll(INLINE)) {
    const groups = match.groups ?? {};
    const from = offset + match.index;
    const to = from + match[0].length;
    const wrapped = (kind: NoteSpanKind, inner: string, open: number) => {
      const close = match[0].length - open - inner.length;
      spans.push({ from, to: from + open, kind: "syntax" });
      spans.push({ from: from + open, to: to - close, kind });
      inlineSpans(inner, from + open, spans);
      spans.push({ from: to - close, to, kind: "syntax" });
    };
    if (groups.code !== undefined) {
      const ticks = groups.tick!.length;
      spans.push({ from, to: from + ticks, kind: "syntax" });
      spans.push({ from: from + ticks, to: to - ticks, kind: "code" });
      spans.push({ from: to - ticks, to, kind: "syntax" });
    } else if (groups.wiki !== undefined) {
      const inner = groups.wiki;
      const open = match[0].length - inner.length - 2;
      const bar = /\\?\|/.exec(inner);
      const reference = bar === null ? inner : inner.slice(0, bar.index);
      const target = reference.split("#")[0]!.trim();
      // With an alias only the alias is the visible text.
      const shown = bar === null ? 0 : bar.index + bar[0].length;
      spans.push({ from, to: from + open + shown, kind: "syntax" });
      spans.push({ from: from + open + shown, to: to - 2, kind: "wiki", target });
      spans.push({ from: to - 2, to, kind: "syntax" });
    } else if (groups.href !== undefined) {
      const label = groups.label ?? "";
      const open = match[0].indexOf("[") + 1;
      const target = groups.href.replace(/^<|>$/g, "");
      spans.push({ from, to: from + open, kind: "syntax" });
      spans.push({ from: from + open, to: from + open + label.length, kind: "link", target });
      inlineSpans(label, from + open, spans);
      spans.push({ from: from + open + label.length, to, kind: "syntax" });
    } else if (groups.bold !== undefined) wrapped("bold", groups.bold, 2);
    else if (groups.bold2 !== undefined) wrapped("bold", groups.bold2, 2);
    else if (groups.strike !== undefined) wrapped("strike", groups.strike, 2);
    else if (groups.italic !== undefined) wrapped("italic", groups.italic, 1);
    else if (groups.italic2 !== undefined) wrapped("italic", groups.italic2, 1);
  }
}

function proseLine(line: string): NoteLine {
  const spans: Array<NoteSpan> = [];
  const heading = HEADING.exec(line);
  if (heading !== null) {
    spans.push({ from: 0, to: heading[0].length, kind: "syntax" });
    inlineSpans(line.slice(heading[0].length), heading[0].length, spans);
    return { block: `h${heading[1]!.length}` as NoteLineBlock, spans, task: null };
  }
  if (RULE.test(line)) return { block: "rule", spans, task: null };
  const quote = QUOTE.exec(line);
  if (quote !== null) {
    spans.push({ from: 0, to: quote[0].length, kind: "syntax" });
    inlineSpans(line.slice(quote[0].length), quote[0].length, spans);
    return { block: "quote", spans, task: null };
  }
  const list = LIST.exec(line);
  if (list === null) {
    if (TABLE.test(line)) return { block: "code", spans, task: null };
    inlineSpans(line, 0, spans);
    return { block: "text", spans, task: null };
  }
  const indent = list[1]!.length;
  const bulleted = list[2] !== undefined;
  const body = list[0].length;
  const task = TASK.exec(line.slice(body));
  if (task === null) {
    if (bulleted) spans.push({ from: indent, to: indent + 1, kind: "bullet" });
    inlineSpans(line.slice(body), body, spans);
    return { block: "list", spans, task: null };
  }
  // The box stands in for a bullet's dash; a number stays beside it.
  spans.push({ from: bulleted ? indent : body, to: body + task[0].length, kind: "syntax" });
  inlineSpans(line.slice(body + task[0].length), body + task[0].length, spans);
  const checked = task[1] !== " ";
  return { block: checked ? "task-done" : "task", spans, task: { at: body + 1, checked } };
}

/** The look of every line of a note, in order. */
export function styleNoteLines(lines: ReadonlyArray<string>): ReadonlyArray<NoteLine> {
  const styled: Array<NoteLine> = [];
  let fence: string | null = null;
  let frontmatter = lines[0] === "---" && lines.indexOf("---", 1) > 0;
  for (const [index, line] of lines.entries()) {
    if (frontmatter) {
      if (index > 0 && line === "---") frontmatter = false;
      styled.push({ block: "meta", spans: [], task: null });
      continue;
    }
    const marker = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (
        marker !== undefined &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker
      ) {
        fence = null;
      }
      styled.push({ block: "code", spans: [], task: null });
    } else if (marker !== undefined) {
      fence = marker;
      styled.push({ block: "code", spans: [], task: null });
    } else styled.push(proseLine(line));
  }
  return styled;
}

/**
 * What Enter writes on a list line: the marker for the next item, or `clear` when the item is
 * empty and Enter ends the list. Null on any other line.
 */
export function nextListMarker(line: string): { readonly marker: string } | "clear" | null {
  const list = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/.exec(line);
  if (list === null) return null;
  if (line.slice(list[0].length).trim() === "") return "clear";
  const [, indent, bullet, number, delimiter, gap, task] = list;
  const lead = bullet ?? `${Number(number) + 1}${delimiter}`;
  return { marker: `${indent}${lead}${gap}${task === undefined ? "" : "[ ] "}` };
}
