import { groupSentences, splitLongSentence } from "./sentences.ts";
import {
  fenceCloses,
  fenceOpening,
  toSpeakableBlocks,
  type FenceState,
  type SpeakableTextOptions,
} from "./speakableText.ts";

export interface SentenceStream {
  push(chunk: string): string[];
  flush(): string[];
}

const SUB_BLOCK_START = /^\s*(?:[-*+]|\d{1,3}[.)]|#{1,6}|>)(?:\s|$)/;
const MAYBE_FENCE = /^ {0,3}[`~]/;
const WORD = /[\p{L}\p{N}]/u;

function linkEnd(text: string, open: number): number {
  let depth = 0;
  let index = open;
  for (; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === "\\") index += 1;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) break;
  }
  if (index >= text.length - 1) return -1;
  const after = text.charAt(index + 1);
  if (after === "[") {
    const close = text.indexOf("]", index + 2);
    return close === -1 ? -1 : close + 1;
  }
  if (after !== "(") return index + 1;
  let parens = 0;
  for (let cursor = index + 1; cursor < text.length; cursor += 1) {
    const char = text.charAt(cursor);
    if (char === "(") parens += 1;
    else if (char === ")" && --parens === 0) return cursor + 1;
  }
  return -1;
}

// Where an inline mark opens that the text so far does not close, or -1.
function unclosedInlineStart(text: string): number {
  const open = { strong: -1, emphasis: -1, underStrong: -1, under: -1, strike: -1 };
  const toggle = (key: keyof typeof open, at: number) => {
    open[key] = open[key] === -1 ? at : -1;
  };
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    const previous = index === 0 ? " " : text.charAt(index - 1);
    if (char === "\\") {
      if (index + 1 >= text.length) return index;
      index += 2;
      continue;
    }
    if (char === "`") {
      let run = 1;
      while (text.charAt(index + run) === "`") run += 1;
      const ticks = "`".repeat(run);
      let close = text.indexOf(ticks, index + run);
      while (close !== -1 && text.charAt(close + run) === "`") {
        while (text.charAt(close + run) === "`") close += 1;
        close = text.indexOf(ticks, close + run);
      }
      if (close === -1 || close + run >= text.length) return earliest(open, index);
      index = close + run;
      continue;
    }
    if (char === "*" || char === "_" || char === "~") {
      let run = 1;
      while (text.charAt(index + run) === char) run += 1;
      const next = text.charAt(index + run);
      if (next === "") return earliest(open, index);
      const strongKey = char === "*" ? "strong" : "underStrong";
      const singleKey = char === "*" ? "emphasis" : "under";
      if (char === "~") {
        if (run >= 2) toggle("strike", index);
      } else {
        const canOpen = !/\s/.test(next) && (char === "*" || !WORD.test(previous));
        const canClose = !/\s/.test(previous);
        if (run >= 2 && (open[strongKey] !== -1 ? canClose : canOpen)) toggle(strongKey, index);
        if (run % 2 === 1 && (open[singleKey] !== -1 ? canClose : canOpen)) {
          toggle(singleKey, index);
        }
      }
      index += run;
      continue;
    }
    if (char === "!" && index + 1 >= text.length) return earliest(open, index);
    if (char === "[" || (char === "!" && text.charAt(index + 1) === "[")) {
      const end = linkEnd(text, char === "!" ? index + 1 : index);
      if (end === -1) return earliest(open, index);
      index = end;
      continue;
    }
    if (char === "<") {
      const next = text.charAt(index + 1);
      if (next === "") return earliest(open, index);
      if (/[A-Za-z/!]/.test(next)) {
        const close = text.indexOf(">", index);
        if (close === -1) return earliest(open, index);
        index = close + 1;
        continue;
      }
    }
    if (char === ":" && !WORD.test(previous) && previous !== ":") {
      let end = index + 1;
      while (/[a-z0-9_+-]/.test(text.charAt(end))) end += 1;
      if (end >= text.length) return earliest(open, index);
    }
    index += 1;
  }
  return earliest(open, -1);
}

function earliest(open: Record<string, number>, fallback: number): number {
  let result = fallback;
  for (const at of Object.values(open)) {
    if (at !== -1 && (result === -1 || at < result)) result = at;
  }
  return result;
}

interface StablePrefix {
  readonly end: number;
  readonly closed: boolean;
}

// How much of the markdown so far can no longer change what it says.
function stablePrefix(buffer: string): StablePrefix {
  let fence: FenceState | null = null;
  let fenceStart = 0;
  let blockStart = 0;
  let subBlockStart = 0;
  let pipeStart = -1;
  let offset = 0;
  while (offset < buffer.length) {
    const newline = buffer.indexOf("\n", offset);
    const complete = newline !== -1;
    const line = buffer.slice(offset, complete ? newline : buffer.length).replace(/\r$/, "");
    const next = complete ? newline + 1 : buffer.length;
    const unquoted = line.replace(/^ {0,3}(?:>\s?)+/, "");
    if (fence) {
      if (complete && fenceCloses(unquoted, fence)) {
        fence = null;
        blockStart = next;
        subBlockStart = next;
        pipeStart = -1;
      }
    } else if (complete && fenceOpening(unquoted)) {
      fence = fenceOpening(unquoted);
      fenceStart = offset;
    } else if (!complete && MAYBE_FENCE.test(unquoted)) {
      return { end: offset, closed: offset <= blockStart };
    } else if (line.trim() === "") {
      if (complete) {
        blockStart = next;
        subBlockStart = next;
        pipeStart = -1;
      }
    } else {
      if (SUB_BLOCK_START.test(line)) subBlockStart = offset;
      if (pipeStart === -1 && line.includes("|")) pipeStart = offset;
    }
    offset = next;
  }
  if (fence) return { end: fenceStart, closed: true };
  if (blockStart >= buffer.length) return { end: buffer.length, closed: true };
  let end = pipeStart === -1 ? buffer.length : pipeStart;
  if (end > subBlockStart) {
    const unclosed = unclosedInlineStart(buffer.slice(subBlockStart, end));
    if (unclosed !== -1) end = subBlockStart + unclosed;
  }
  return { end, closed: end <= blockStart };
}

export function createSentenceStream(options?: SpeakableTextOptions): SentenceStream {
  let buffer = "";
  let emitted = 0;

  const read = (markdown: string) => {
    const blocks = toSpeakableBlocks(markdown, options);
    return { blocks, ...groupSentences(blocks.map((block) => block.text).join("\n\n")) };
  };

  return {
    push(chunk) {
      buffer += chunk;
      const { end, closed } = stablePrefix(buffer);
      const { blocks, units, tail } = read(buffer.slice(0, end));
      const stable = closed || tail !== "" ? units.length : units.length - 1;
      const ready = units.slice(emitted, stable);
      emitted = Math.max(emitted, stable);
      const last = blocks.at(-1);
      if (closed && end === buffer.length && tail === "" && last?.kind === "text" && !last.inList) {
        buffer = "";
        emitted = 0;
      }
      return ready.flatMap(splitLongSentence);
    },
    flush() {
      const { units, tail } = read(buffer);
      const rest = units.slice(emitted);
      if (tail !== "") {
        const last = rest.pop();
        rest.push(last === undefined ? tail : `${last} ${tail}`);
      }
      buffer = "";
      emitted = 0;
      return rest.flatMap(splitLongSentence);
    },
  };
}
