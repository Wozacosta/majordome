/**
 * What the feed says about each change in plain words: the start of a run's final reply, which
 * routine started it, the daily note "Start my day" wrote, and the titles of the notes it touched.
 * Read only for the entries the feed shows; a run whose thread is gone simply has no summary.
 */

import {
  type MajordomeRoutineKind,
  type MajordomeVaultHistoryEntry,
  type OrchestrationV2Run,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import type { VaultLayout } from "./vaultConfig.ts";

const SUMMARY_MAX = 200;
const PREVIEW_MAX = 400;
const PREVIEW_LINES = 6;
const NOTE_HEAD_BYTES = 4096;
const MAX_NOTES = 300;

const RUN_ORDINAL = /^Run (\d+) of this thread\.$/m;
const ROUTINE_TASK = /^majordome:.+:(start-my-day|review-my-week|digest-my-inbox)$/;
const ROUTINE_TITLES: Record<string, MajordomeRoutineKind> = {
  "start my day": "start-my-day",
  "review my week": "review-my-week",
  "digest my inbox": "digest-my-inbox",
};
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^\s*#{1,6}\s+/;
const LIST_ITEM = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;

/** The run number in a run commit's body ("Run 3 of this thread."), or null. */
export function runOrdinalOf(body: string): number | null {
  const ordinal = Number(RUN_ORDINAL.exec(body)?.[1]);
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

/** The default routine a scheduled task is, or the run's title names. */
export function routineOf(input: {
  readonly scheduledTaskId: string | undefined;
  readonly subject: string;
}): MajordomeRoutineKind | null {
  const fromTask = input.scheduledTaskId && ROUTINE_TASK.exec(input.scheduledTaskId)?.[1];
  if (fromTask) return fromTask as MajordomeRoutineKind;
  const title = input.subject
    .replace(/^majordome:\s*/, "")
    .trim()
    .toLowerCase();
  return ROUTINE_TITLES[title] ?? null;
}

/** One line of Markdown as plain words: no heading, quote or list markers, emphasis or links. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s*)*/, "")
    .replace(LIST_ITEM, "")
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/\*\*|__|`|~~/g, "")
    .replaceAll(/(^|\W)[*_](\S[^*_]*\S|\S)[*_](?=\W|$)/g, "$1$2")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const atWord = /\s/.test(text[max - 1] ?? "") ? cut : cut.replace(/\s+\S*$/, "");
  return `${(atWord.length > max / 2 ? atWord : cut).trimEnd()}…`;
}

function withoutFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/.exec(text);
  return match === null ? text : text.slice(match[0].length);
}

/**
 * The first paragraph of a reply that says something, as plain words: headings on their own,
 * code blocks, tables and rules are skipped.
 */
export function replySummary(text: string, max = SUMMARY_MAX): string | null {
  const paragraphs: Array<Array<string>> = [[]];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      paragraphs.push([]);
      continue;
    }
    if (inFence || line.trim() === "" || RULE.test(line) || /^\s*\|/.test(line)) {
      paragraphs.push([]);
      continue;
    }
    if (HEADING.test(line)) {
      paragraphs.push([]);
      continue;
    }
    paragraphs.at(-1)!.push(line);
  }
  for (const lines of paragraphs) {
    const parts = lines.map(plainLine).filter((part) => part !== "");
    if (parts.length === 0) continue;
    const joined = lines.some((line) => LIST_ITEM.test(line))
      ? parts.map((part) => part.replace(/[.;:,]$/, "")).join("; ")
      : parts.join(" ");
    return cap(joined, max);
  }
  return null;
}

/** A note's first `# heading`, after any frontmatter. */
export function noteHeading(text: string): string | null {
  for (const line of withoutFrontmatter(text).split(/\r?\n/)) {
    const match = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (match?.[1]) return plainLine(match[1]) || null;
  }
  return null;
}

/** The start of a daily note, as a few plain lines, without its frontmatter or title. */
export function dailyNotePreview(text: string): string | null {
  const lines: Array<string> = [];
  let inFence = false;
  for (const line of withoutFrontmatter(text).split(/\r?\n/)) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || RULE.test(line) || /^#\s/.test(line)) continue;
    const plain = plainLine(line);
    if (plain === "") continue;
    lines.push(LIST_ITEM.test(line) ? `• ${plain}` : plain);
    if (lines.length >= PREVIEW_LINES) break;
  }
  return lines.length === 0 ? null : cap(lines.join("\n"), PREVIEW_MAX);
}

const DAILY_NOTE = /^\d{4}-\d{2}-\d{2}\.md$/;

/** The daily note a change touched, if any (`daily/2026-11-15.md`). */
export function touchedDailyNote(files: ReadonlyArray<string>, dailyFolder: string): string | null {
  const prefix = `${dailyFolder.replace(/\/+$/, "")}/`;
  return (
    files.find((file) => file.startsWith(prefix) && DAILY_NOTE.test(file.slice(prefix.length))) ??
    null
  );
}

interface RunFacts {
  readonly summary: string | null;
  readonly scheduledTaskId: string | undefined;
}

/** The final reply and starting task of each listed run of one thread; empty when it is gone. */
const readThreadRuns = Effect.fn("majordome.readThreadRuns")(function* (
  threadId: string,
  ordinals: ReadonlyArray<number>,
) {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const id = ThreadId.make(threadId);
  const { runs } = yield* projections.getThreadRecords(id, ["runs"]);
  const wanted = new Set(ordinals);
  const matched = runs.filter((run: OrchestrationV2Run) => wanted.has(run.ordinal));
  if (matched.length === 0) return new Map<number, RunFacts>();
  const { messages } = yield* projections.getThreadRecords(id, ["messages"], {
    messageRunIds: matched.map((run) => run.id),
    messageRoles: ["assistant"],
  });
  const prompts = yield* projections.getMessagesById(
    id,
    matched.map((run) => run.userMessageId),
  );
  return new Map(
    matched.map((run) => {
      const reply = messages
        .filter(
          (message) =>
            message.runId === run.id && message.role === "assistant" && message.text.trim() !== "",
        )
        .toSorted(
          (a, b) => DateTime.toEpochMillis(a.createdAt) - DateTime.toEpochMillis(b.createdAt),
        )
        .at(-1);
      return [
        run.ordinal,
        {
          summary: reply === undefined ? null : replySummary(reply.text),
          scheduledTaskId: prompts.get(run.userMessageId)?.scheduledTaskId,
        },
      ] as const;
    }),
  );
});

/** Up to the first few KB of a file, or None when it is missing or unreadable. */
const readHead = Effect.fn("majordome.readNoteHead")(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* Effect.scoped(
    fileSystem.open(file).pipe(Effect.flatMap((handle) => handle.readAlloc(NOTE_HEAD_BYTES))),
  ).pipe(
    Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes))),
    Effect.orElseSucceed(() => Option.none<string>()),
  );
});

/** Adds summaries, routines and daily note previews to the entries, and titles their notes. */
export const describeVaultHistory = Effect.fn("majordome.describeVaultHistory")(function* (input: {
  readonly cwd: string;
  readonly layout: VaultLayout;
  readonly entries: ReadonlyArray<MajordomeVaultHistoryEntry>;
}) {
  const path = yield* Path.Path;

  const ordinalsByThread = new Map<string, Array<number>>();
  for (const entry of input.entries) {
    const ordinal = entry.byMajordome ? runOrdinalOf(entry.body) : null;
    if (entry.threadId === null || ordinal === null) continue;
    const ordinals = ordinalsByThread.get(entry.threadId) ?? [];
    ordinals.push(ordinal);
    ordinalsByThread.set(entry.threadId, ordinals);
  }
  const runsByThread = new Map(
    yield* Effect.forEach(
      [...ordinalsByThread],
      ([threadId, ordinals]) =>
        readThreadRuns(threadId, ordinals).pipe(
          // A deleted thread, or one this server never had, leaves its runs without a summary.
          Effect.orElseSucceed(() => new Map<number, RunFacts>()),
          Effect.map((runs) => [threadId, runs] as const),
        ),
      { concurrency: 4 },
    ),
  );

  const noteFiles = [
    ...new Set(
      input.entries.flatMap((entry) =>
        entry.files.filter((file) => file.endsWith(".md") && !file.startsWith(".majordome/")),
      ),
    ),
  ].slice(0, MAX_NOTES);
  const heads = new Map(
    yield* Effect.forEach(
      noteFiles,
      (file) =>
        readHead(path.join(input.cwd, file)).pipe(Effect.map((head) => [file, head] as const)),
      { concurrency: 8 },
    ),
  );
  const notes: Record<string, string | null> = {};
  for (const [file, head] of heads) {
    if (Option.isSome(head)) notes[file] = noteHeading(head.value);
  }

  const entries = input.entries.map((entry): MajordomeVaultHistoryEntry => {
    if (!entry.byMajordome || entry.threadId === null) return entry;
    const ordinal = runOrdinalOf(entry.body);
    const facts = ordinal === null ? undefined : runsByThread.get(entry.threadId)?.get(ordinal);
    const routine = routineOf({
      scheduledTaskId: facts?.scheduledTaskId,
      subject: entry.subject,
    });
    const daily =
      routine === "start-my-day" ? touchedDailyNote(entry.files, input.layout.dailyFolder) : null;
    const dailyHead = daily === null ? undefined : heads.get(daily);
    return {
      ...entry,
      summary: facts?.summary ?? null,
      routine,
      dailyNotePreview:
        dailyHead !== undefined && Option.isSome(dailyHead)
          ? dailyNotePreview(dailyHead.value)
          : null,
    };
  });
  return { entries, notes };
});
