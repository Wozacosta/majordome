export interface SpeakableTextOptions {
  readonly locale?: string;
  readonly codeLine?: string;
  readonly tableLine?: string;
  readonly linkWord?: string;
}

export interface SpeakableBlock {
  readonly kind: "text" | "code" | "table";
  readonly text: string;
  readonly inList: boolean;
}

const DEFAULT_CODE_LINE = "There is code on screen.";
const DEFAULT_TABLE_LINE = "There is a table on screen.";
const DEFAULT_LINK_WORD = "a link";

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)\s*$/;
const HEADING = /^ {0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
const TASK_BOX = /^\[[ xX]\]\s+/;
const QUOTE_PREFIX = /^ {0,3}(?:>\s?)+/;
const CALLOUT = /^\[![A-Za-z]+\]\s*/;
const DEFINITION = /^ {0,3}\[[^\]]+\]:\s*\S*/;
const INDENTED = /^(?: {4}|\t)/;
const ENDS_SENTENCE = /[.!?…:;,][)"'»”’\]]*$/;

export interface FenceState {
  readonly char: string;
  readonly length: number;
}

export function fenceOpening(line: string): FenceState | null {
  const match = FENCE_OPEN.exec(line);
  if (!match?.[1]) return null;
  const char = match[1].charAt(0);
  if (char === "`" && line.slice(match[0].length).includes("`")) return null;
  return { char, length: match[1].length };
}

export function fenceCloses(line: string, fence: FenceState): boolean {
  const trimmed = line.trim();
  if (trimmed.length < fence.length) return false;
  for (const char of trimmed) if (char !== fence.char) return false;
  return line.length - line.trimStart().length <= 3;
}

function isTableStart(line: string, next: string | undefined): boolean {
  if (next === undefined || !TABLE_DELIMITER.test(next)) return false;
  return line.includes("|") || next.includes("|");
}

const PLACEHOLDER = /(\d+)/g;

function cleanInline(source: string, linkWord: string): string {
  const kept: string[] = [];
  const keep = (value: string) => `${kept.push(value) - 1}`;

  let text = source.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_match, _ticks, code: string) =>
    keep(code.trim()),
  );
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!|>~<:])/g, (_match, char: string) => keep(char));
  text = text.replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g, " ");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text
      .replace(
        /\[((?:[^[\]]|\[[^[\]]*\])*)\]\((?:[^()\s]|\([^()]*\))*(?:\s+(?:"[^"]*"|'[^']*'))?\)/g,
        "$1",
      )
      .replace(/\[((?:[^[\]^]|\[[^[\]]*\])[^[\]]*)\]\[[^\]]*\]/g, "$1");
    if (next === text) break;
    text = next;
  }
  text = text.replace(/\[\^[^\]\s]+\]/g, "");
  text = text.replace(/<(?:https?:\/\/|mailto:)[^>\s]+>/gi, linkWord);
  text = text.replace(/<br\s*\/?>/gi, " ");
  text = text.replace(/<\/?[A-Za-z][^<>]*>/g, "");
  text = text.replace(/(?:https?:\/\/|www\.)[^\s<>"]+/gi, (url) => {
    const trailing = /[.,;:!?)\]'"»]+$/.exec(url)?.[0] ?? "";
    return linkWord + trailing;
  });
  for (let pass = 0; pass < 4; pass += 1) {
    const next = text
      .replace(/(\*{1,3})(?=\S)([^*]*?\S)\1/g, "$2")
      .replace(/(?<![\p{L}\p{N}_])(_{1,3})(?=\S)([^_]*?\S)\1(?![\p{L}\p{N}_])/gu, "$2")
      .replace(/~~(?=\S)([^~]*?\S)~~/g, "$1")
      .replace(/==(?=\S)([^=]*?\S)==/g, "$1");
    if (next === text) break;
    text = next;
  }
  text = text.replace(/\*{2,}|~~/g, "");
  text = text.replace(/(?<![\p{L}\p{N}:]):(?:[a-z][a-z0-9_+-]*|[+-]1):(?![\p{L}\p{N}:])/gu, "");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
  text = text.replace(PLACEHOLDER, (_match, index: string) => kept[Number(index)] ?? "");
  return text
    .replace(/\s+/g, " ")
    .replace(/ ([.,])(?=\s|$)/g, "$1")
    .trim();
}

function finishText(raw: string, linkWord: string): string {
  const text = cleanInline(raw, linkWord);
  if (text === "" || !/[\p{L}\p{N}]/u.test(text)) return "";
  return ENDS_SENTENCE.test(text) ? text : `${text}.`;
}

export function toSpeakableBlocks(
  markdown: string,
  options: SpeakableTextOptions = {},
): SpeakableBlock[] {
  const codeLine = options.codeLine ?? DEFAULT_CODE_LINE;
  const tableLine = options.tableLine ?? DEFAULT_TABLE_LINE;
  const linkWord = options.linkWord ?? DEFAULT_LINK_WORD;
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: SpeakableBlock[] = [];
  let pending: string[] = [];
  let pendingInList = false;
  let listContext = false;

  const closeText = () => {
    if (pending.length === 0) return;
    const text = finishText(pending.join(" "), linkWord);
    if (text !== "") blocks.push({ kind: "text", text, inList: pendingInList });
    pending = [];
  };
  const pushMarker = (kind: "code" | "table") => {
    closeText();
    if (blocks.at(-1)?.kind === kind) return;
    blocks.push({ kind, text: kind === "code" ? codeLine : tableLine, inList: listContext });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index] ?? "";
    const quoted = QUOTE_PREFIX.test(original);
    const line = quoted ? original.replace(QUOTE_PREFIX, "") : original;

    const fence = fenceOpening(line);
    if (fence) {
      pushMarker("code");
      index += 1;
      while (index < lines.length) {
        const inner = (lines[index] ?? "").replace(QUOTE_PREFIX, "");
        if (fenceCloses(inner, fence)) break;
        index += 1;
      }
      continue;
    }

    if (line.trim() === "") {
      closeText();
      continue;
    }

    if (
      pending.length === 0 &&
      !listContext &&
      !quoted &&
      INDENTED.test(line) &&
      !LIST_ITEM.test(line)
    ) {
      pushMarker("code");
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? "";
        if (next.trim() !== "" && !INDENTED.test(next)) break;
        if (next.trim() === "" && !INDENTED.test(lines[index + 2] ?? "")) break;
        index += 1;
      }
      continue;
    }

    if (isTableStart(line, lines[index + 1]?.replace(QUOTE_PREFIX, ""))) {
      pushMarker("table");
      index += 1;
      while (index + 1 < lines.length) {
        const next = (lines[index + 1] ?? "").replace(QUOTE_PREFIX, "");
        if (next.trim() === "" || !next.includes("|")) break;
        index += 1;
      }
      continue;
    }

    if (RULE.test(line) || (pending.length > 0 && SETEXT_UNDERLINE.test(line))) {
      closeText();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      closeText();
      listContext = false;
      pendingInList = false;
      pending.push(heading[1] ?? "");
      closeText();
      continue;
    }

    if (DEFINITION.test(line) && pending.length === 0) continue;

    const item = LIST_ITEM.exec(line);
    if (item) {
      closeText();
      listContext = true;
      pendingInList = true;
      pending.push((item[1] ?? "").replace(TASK_BOX, ""));
      continue;
    }

    if (pending.length === 0) {
      if (!/^\s/.test(line)) listContext = false;
      pendingInList = listContext;
    }
    pending.push(pending.length === 0 ? line.trim().replace(CALLOUT, "") : line.trim());
  }
  closeText();
  return blocks;
}

export function toSpeakableText(markdown: string, options?: SpeakableTextOptions): string {
  return toSpeakableBlocks(markdown, options)
    .map((block) => block.text)
    .join("\n\n");
}
