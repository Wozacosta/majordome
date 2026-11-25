/**
 * Topics: the owner's long-running conversations, each tied to one folder of the vault. The list
 * lives in the vault, `.majordome/topics.json`, so it travels with the notes. Which thread holds a
 * topic's conversation is each server's own business (see MajordomeTopics.ts).
 */

import {
  MajordomeTopicIcon,
  type MajordomeTopicSuggestion,
  MajordomeVaultTopic,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { topicStanding } from "./topicPreview.ts";
import { normalizeTopicFolder, VAULT_CONFIG_DIRNAME, type VaultLayout } from "./vaultConfig.ts";

const TOPICS_FILENAME = "topics.json";

const topicsFilePath = (path: Path.Path, vaultRoot: string) =>
  path.join(vaultRoot, VAULT_CONFIG_DIRNAME, TOPICS_FILENAME);

// The icon is checked on its own, so an unknown one (from a newer Majordome) keeps the topic.
const decodeTopic = Schema.decodeUnknownOption(
  Schema.Struct({
    id: MajordomeVaultTopic.fields.id,
    title: MajordomeVaultTopic.fields.title,
    folder: MajordomeVaultTopic.fields.folder,
  }),
);
const isTopicIcon = Schema.is(MajordomeTopicIcon);

/** The topics a `topics.json` holds, in its order. Entries that don't make sense are dropped. */
export function parseVaultTopics(text: string): ReadonlyArray<MajordomeVaultTopic> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const entries =
    typeof raw === "object" && raw !== null && "topics" in raw && Array.isArray(raw.topics)
      ? (raw.topics as ReadonlyArray<unknown>)
      : [];
  const seen = new Set<string>();
  const topics: Array<MajordomeVaultTopic> = [];
  for (const entry of entries) {
    const topic = Option.getOrUndefined(decodeTopic(entry));
    if (topic === undefined || seen.has(topic.id)) continue;
    const folder = normalizeTopicFolder(topic.folder);
    if (folder === null) continue;
    seen.add(topic.id);
    const { icon, finishedAt } = entry as {
      readonly icon?: unknown;
      readonly finishedAt?: unknown;
    };
    topics.push({
      id: topic.id,
      title: topic.title,
      folder,
      ...(isTopicIcon(icon) ? { icon } : {}),
      ...(typeof finishedAt === "string" && finishedAt.trim() !== "" ? { finishedAt } : {}),
    });
  }
  return topics;
}

export function serializeVaultTopics(topics: ReadonlyArray<MajordomeVaultTopic>): string {
  const entries = topics.map(({ id, title, folder, icon, finishedAt }) => ({
    id,
    title,
    folder,
    ...(icon === undefined ? {} : { icon }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
  }));
  return `${JSON.stringify({ topics: entries }, null, 2)}\n`;
}

/** `lisbon-move` → `Lisbon move`; a name already written with capitals stays as it is. */
export function topicTitleFromFolder(folder: string): string {
  const name = (folder.split("/").at(-1) ?? folder)
    .replace(/^\d+[\s._-]+/, "")
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (name === "") return folder;
  if (/[A-Z]/.test(name)) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function slugifyTopicTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug === "" ? "topic" : slug;
}

/** A readable id from the title, unique among `taken`. */
export function newTopicId(title: string, taken: ReadonlySet<string>): string {
  const base = slugifyTopicTitle(title);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The topics in the order of `ids`; ones it leaves out keep their order at the end. */
export function reorderVaultTopics(
  topics: ReadonlyArray<MajordomeVaultTopic>,
  ids: ReadonlyArray<string>,
): ReadonlyArray<MajordomeVaultTopic> {
  const byId = new Map(topics.map((topic) => [topic.id, topic] as const));
  const ordered: Array<MajordomeVaultTopic> = [];
  for (const id of ids) {
    const topic = byId.get(id);
    if (topic === undefined) continue;
    ordered.push(topic);
    byId.delete(id);
  }
  return [...ordered, ...topics.filter((topic) => byId.has(topic.id))];
}

export interface VaultFolder {
  readonly path: string;
  /** Markdown notes in the folder and the folders below it, as far as the listing went. */
  readonly notes: number;
  /** When the most recently changed of those notes changed, in epoch ms; 0 when unknown. */
  readonly newestNoteMs?: number;
  /** The folder, or one above it, is a separate git repository (code), not notes. */
  readonly inRepo?: boolean;
}

/** Folder names that hold files for notes, templates or periodic notes, never a topic. */
const SYSTEM_FOLDER_NAMES = new Set([
  "attachments",
  "assets",
  "images",
  "media",
  "templates",
  "template",
  "weekly",
  "monthly",
  "node_modules",
]);

/** Folders of old things: they can hold a topic, but none is suggested there. */
const OLD_FOLDER_NAMES = new Set(["archive", "archives", "done"]);

/**
 * False for the vault's own folders and anything in them: dot folders, the daily notes and inbox
 * its config names, and attachment, template and periodic-note folders (`_attachments` included).
 */
export function canHoldTopic(
  folder: string,
  layout: Pick<VaultLayout, "dailyFolder" | "inboxFolder">,
): boolean {
  const lower = folder.toLowerCase();
  const isRoleFolder = [layout.dailyFolder, layout.inboxFolder].some((role) => {
    const roleFolder = normalizeTopicFolder(role)?.toLowerCase();
    return roleFolder !== undefined && (lower === roleFolder || lower.startsWith(`${roleFolder}/`));
  });
  return (
    !isRoleFolder &&
    !lower
      .split("/")
      .some(
        (segment) => segment.startsWith(".") || SYSTEM_FOLDER_NAMES.has(segment.replace(/^_+/, "")),
      )
  );
}

const SUGGESTION_LIMIT = 12;

/**
 * Up to twelve folders that look like topics, most recently written in first: second-level folders
 * of any area and top-level leaves. Skips folders that can't hold a topic, old things, `_` folders,
 * code repositories, empty folders and folders in `taken`.
 */
export function suggestTopics(input: {
  readonly folders: ReadonlyArray<VaultFolder>;
  readonly layout: Pick<VaultLayout, "dailyFolder" | "inboxFolder" | "projectsFolder">;
  readonly taken: ReadonlySet<string>;
}): ReadonlyArray<MajordomeTopicSuggestion> {
  const isPlumbing = (folder: string) =>
    !canHoldTopic(folder, input.layout) ||
    folder.split("/").some((segment) => {
      const name = segment.toLowerCase();
      return OLD_FOLDER_NAMES.has(name) || name.startsWith("_");
    });
  const usable = input.folders.filter(
    (folder) => !isPlumbing(folder.path) && !input.taken.has(folder.path) && !folder.inRepo,
  );
  const depth = (folder: string) => folder.split("/").length;
  const hasChildren = (folder: string) =>
    input.folders.some((other) => other.path.startsWith(`${folder}/`) && !isPlumbing(other.path));
  const withNotes = usable.filter((folder) => folder.notes > 0);
  const projectsFolder = normalizeTopicFolder(input.layout.projectsFolder);
  const nested = withNotes.filter((folder) => depth(folder.path) === 2);
  const leaves = withNotes.filter(
    (folder) =>
      depth(folder.path) === 1 && folder.path !== projectsFolder && !hasChildren(folder.path),
  );
  // Where the owner writes most lately comes first, then the fuller folder.
  return [...nested, ...leaves]
    .toSorted(
      (a, b) =>
        (b.newestNoteMs ?? 0) - (a.newestNoteMs ?? 0) ||
        b.notes - a.notes ||
        a.path.localeCompare(b.path),
    )
    .slice(0, SUGGESTION_LIMIT)
    .map((folder) => ({ title: topicTitleFromFolder(folder.path), folder: folder.path }));
}

const FOLDER_LIST_DEPTH = 3;
const FOLDER_LIST_LIMIT = 400;

const isListedName = (name: string) => !name.startsWith(".") && name !== "node_modules";

/** The vault's folders, shallowest first and alphabetical, plumbing left out. */
export const listVaultFolders = Effect.fn("majordome.listVaultFolders")(function* (
  vaultRoot: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ownNotes = new Map<string, number>();
  const ownNewest = new Map<string, number>();
  const repos = new Set<string>();
  let level: Array<string> = [""];
  // One level deeper than listed, to count the notes in the deepest listed folders.
  for (let depth = 0; depth <= FOLDER_LIST_DEPTH && level.length > 0; depth += 1) {
    const next: Array<string> = [];
    for (const parent of level) {
      const entries = yield* fileSystem
        .readDirectoryEntries(parent === "" ? vaultRoot : path.join(vaultRoot, parent))
        .pipe(Effect.orElseSucceed((): ReadonlyArray<FileSystem.DirectoryEntry> => []));
      let notes = 0;
      let newest = 0;
      for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === ".git" && parent !== "") repos.add(parent);
        if (!isListedName(entry.name)) continue;
        if (entry.type === "File" && entry.name.toLowerCase().endsWith(".md")) {
          notes += 1;
          const info = yield* fileSystem
            .stat(path.join(vaultRoot, parent, entry.name))
            .pipe(Effect.option);
          const changedMs = Option.isSome(info)
            ? Option.match(info.value.mtime, { onNone: () => 0, onSome: (date) => date.getTime() })
            : 0;
          newest = Math.max(newest, changedMs);
        }
        if (
          entry.type === "Directory" &&
          depth < FOLDER_LIST_DEPTH &&
          ownNotes.size + next.length < FOLDER_LIST_LIMIT
        ) {
          next.push(parent === "" ? entry.name : `${parent}/${entry.name}`);
        }
      }
      if (parent !== "") {
        ownNotes.set(parent, notes);
        ownNewest.set(parent, newest);
      }
    }
    level = next;
  }
  const folders = [...ownNotes.keys()];
  return folders.map((folder): VaultFolder => {
    const subtree = folders.filter((other) => other === folder || other.startsWith(`${folder}/`));
    return {
      path: folder,
      notes: subtree.reduce((sum, other) => sum + (ownNotes.get(other) ?? 0), 0),
      newestNoteMs: subtree.reduce((max, other) => Math.max(max, ownNewest.get(other) ?? 0), 0),
      inRepo: [...repos].some((repo) => folder === repo || folder.startsWith(`${repo}/`)),
    };
  });
});

/** The vault's topics; none when the file is missing or unreadable. */
export const readVaultTopics = Effect.fn("majordome.readVaultTopics")(function* (
  vaultRoot: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fileSystem
    .readFileString(topicsFilePath(path, vaultRoot))
    .pipe(Effect.option);
  return Option.match(text, { onNone: () => [], onSome: parseVaultTopics });
});

/** When the list of topics was last written; none when there is no list. */
export const vaultTopicsChangedAt = Effect.fn("majordome.vaultTopicsChangedAt")(function* (
  vaultRoot: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const info = yield* fileSystem.stat(topicsFilePath(path, vaultRoot)).pipe(Effect.option);
  return Option.flatMap(info, (stat) => stat.mtime).pipe(Option.map((date) => date.getTime()));
});

export const writeVaultTopics = Effect.fn("majordome.writeVaultTopics")(function* (input: {
  readonly vaultRoot: string;
  readonly topics: ReadonlyArray<MajordomeVaultTopic>;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.writeFileString(
    topicsFilePath(path, input.vaultRoot),
    serializeVaultTopics(input.topics),
  );
});

/** Everything a topic adds to a session's vault context, in characters. */
export const TOPIC_CONTEXT_CHAR_LIMIT = 6_000;
const NOTES_LISTING_LIMIT = 30;
const LOG_NOTE_LIMIT = 2_500;
const README_NOTE_LIMIT = 1_200;
const RECENT_NOTE_LIMIT = 1_000;
/** Below this, another note would be too short to be worth reading. */
const MIN_NOTE_BUDGET = 200;
const TOPIC_NOTE_DEPTH = 3;
const TOPIC_NOTE_SCAN_LIMIT = 200;

const STANDING_HEADING = "## Where things stand";

const escapeAttribute = (value: string) => value.replaceAll('"', "&quot;");

function head(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}\n[…the note goes on.]`;
}

/** The end of a running log is its newest part. */
function tail(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length <= limit
    ? trimmed
    : `[…earlier entries left out.]\n${trimmed.slice(trimmed.length - limit)}`;
}

/** A long log keeps where things stand, from its top, ahead of its newest entries. */
function logTail(text: string, limit: number): string {
  const standing = text.trim().length <= limit ? null : topicStanding(text);
  if (standing === null) return tail(text, limit);
  const top = `${STANDING_HEADING}\n${standing}\n`;
  return `${top}${tail(text, limit - top.length)}`;
}

interface TopicNote {
  readonly path: string;
  readonly changedAt: number;
}

const listTopicNotes = Effect.fn("majordome.listTopicNotes")(function* (folderPath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const notes: Array<TopicNote> = [];
  let total = 0;
  let level: Array<string> = [""];
  for (let depth = 1; depth <= TOPIC_NOTE_DEPTH && level.length > 0; depth += 1) {
    const next: Array<string> = [];
    for (const parent of level) {
      const entries = yield* fileSystem
        .readDirectoryEntries(parent === "" ? folderPath : path.join(folderPath, parent))
        .pipe(Effect.orElseSucceed((): ReadonlyArray<FileSystem.DirectoryEntry> => []));
      for (const entry of entries) {
        if (!isListedName(entry.name)) continue;
        const relative = parent === "" ? entry.name : `${parent}/${entry.name}`;
        if (entry.type === "Directory") next.push(relative);
        else if (entry.type === "File" && entry.name.toLowerCase().endsWith(".md")) {
          total += 1;
          // Past the limit a note is only counted.
          if (notes.length >= TOPIC_NOTE_SCAN_LIMIT) continue;
          const info = yield* fileSystem.stat(path.join(folderPath, relative)).pipe(Effect.option);
          const changedAt = Option.match(
            Option.flatMap(info, (value) => value.mtime),
            {
              onNone: () => 0,
              onSome: (date) => date.getTime(),
            },
          );
          notes.push({ path: relative, changedAt });
        }
      }
    }
    level = next;
  }
  return {
    notes: notes.toSorted((a, b) => b.changedAt - a.changedAt || a.path.localeCompare(b.path)),
    total,
  };
});

const logOf = (notes: ReadonlyArray<TopicNote>) =>
  notes.find((note) => note.path.toLowerCase() === "log.md");

/**
 * What a topic's folder says of it, from one walk: how many notes it holds, and where things
 * stand as the top of its `log.md` puts it (null when the log has no such section).
 */
export const readTopicFolderFacts = Effect.fn("majordome.readTopicFolderFacts")(function* (
  folderPath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { notes, total } = yield* listTopicNotes(folderPath);
  const log = logOf(notes);
  const text =
    log === undefined
      ? null
      : topicStanding(
          yield* fileSystem
            .readFileString(path.join(folderPath, log.path))
            .pipe(Effect.orElseSucceed(() => "")),
        );
  return {
    notesCount: total,
    standing:
      log === undefined || text === null
        ? null
        : {
            text,
            ...(log.changedAt === 0
              ? {}
              : { updatedAt: DateTime.formatIso(DateTime.makeUnsafe(log.changedAt)) }),
          },
  };
});

const isoDay = (epochMillis: number) =>
  epochMillis === 0 ? null : DateTime.formatIsoDate(DateTime.makeUnsafe(epochMillis));

/**
 * The topic's part of a session's vault context: what this conversation is, where its memory
 * lives, the folder's notes and the contents of its key ones (`log.md`, `README.md` or
 * `index.md`, then the most recently changed), all within `TOPIC_CONTEXT_CHAR_LIMIT`.
 */
export const readTopicContext = Effect.fn("majordome.readTopicContext")(function* (input: {
  readonly vaultRoot: string;
  readonly topic: MajordomeVaultTopic;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { topic } = input;
  const folderPath = path.join(input.vaultRoot, topic.folder);
  const { notes, total } = yield* listTopicNotes(folderPath);
  const logPath = `${topic.folder}/log.md`;

  const opening = [
    `<topic title="${escapeAttribute(topic.title)}" folder="${escapeAttribute(topic.folder)}">`,
    `This conversation is the topic "${topic.title}". Its memory is the folder ${topic.folder}: keep its running log in ${logPath} (what was decided, done or learned, newest last), because this chat may be compacted or restarted. At the very top of ${logPath} keep a section headed exactly "${STANDING_HEADING}": at most three short plain lines saying where things are now and what comes next, with its date when there is one. Rewrite that section whenever something changes; the dated entries stay below it, newest last.`,
  ].join("\n");
  const closing = "</topic>";

  const listingLines = notes.slice(0, NOTES_LISTING_LIMIT).map((note) => {
    const day = isoDay(note.changedAt);
    return day === null ? `- ${note.path}` : `- ${note.path} (changed ${day})`;
  });
  if (total > NOTES_LISTING_LIMIT) {
    listingLines.push(`- …and ${total - NOTES_LISTING_LIMIT} more`);
  }
  const listing =
    notes.length === 0
      ? "<notes>The folder has no notes yet.</notes>"
      : `<notes>\n${listingLines.join("\n")}\n</notes>`;

  const parts: Array<string> = [opening, listing];
  let budget =
    TOPIC_CONTEXT_CHAR_LIMIT - opening.length - listing.length - closing.length - parts.length - 1;

  const byName = (name: string) =>
    notes.find((note) => note.path.toLowerCase() === name) ?? undefined;
  const picks: Array<{ note: TopicNote; limit: number; cut: typeof head }> = [];
  const log = logOf(notes);
  if (log) picks.push({ note: log, limit: LOG_NOTE_LIMIT, cut: logTail });
  const readme = byName("readme.md") ?? byName("index.md");
  if (readme) picks.push({ note: readme, limit: README_NOTE_LIMIT, cut: head });
  for (const note of notes) {
    if (note === log || note === readme) continue;
    picks.push({ note, limit: RECENT_NOTE_LIMIT, cut: head });
  }

  for (const pick of picks) {
    const notePath = `${topic.folder}/${pick.note.path}`;
    const open = `<note path="${escapeAttribute(notePath)}">\n`;
    const close = "\n</note>";
    // The cut adds a one-line marker of up to 30 characters.
    const room = Math.min(pick.limit, budget - open.length - close.length - 31);
    if (room < MIN_NOTE_BUDGET) break;
    const text = yield* fileSystem
      .readFileString(path.join(folderPath, pick.note.path))
      .pipe(Effect.option, Effect.map(Option.getOrElse(() => "")));
    if (text.trim() === "") continue;
    const block = `${open}${pick.cut(text, room)}${close}`;
    parts.push(block);
    budget -= block.length + 1;
  }
  parts.push(closing);
  return parts.join("\n");
});
