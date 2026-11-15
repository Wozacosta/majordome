/**
 * Topics: the owner's long-running conversations, each tied to one folder of the vault. The list
 * lives in the vault, `.majordome/topics.json`, so it travels with the notes. Which thread holds a
 * topic's conversation is each server's own business (see MajordomeTopics.ts).
 */

import { type MajordomeTopicSuggestion, MajordomeVaultTopic } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { VAULT_CONFIG_DIRNAME, type VaultLayout } from "./vaultConfig.ts";

const TOPICS_FILENAME = "topics.json";

const topicsFilePath = (path: Path.Path, vaultRoot: string) =>
  path.join(vaultRoot, VAULT_CONFIG_DIRNAME, TOPICS_FILENAME);

const decodeTopic = Schema.decodeUnknownOption(MajordomeVaultTopic);

/**
 * A vault-relative folder with forward slashes, or null when it is empty, absolute, climbs out of
 * the vault, or is plumbing (a dot folder).
 */
export function normalizeTopicFolder(value: string): string | null {
  const trimmed = value.trim().replaceAll("\\", "/");
  if (trimmed.startsWith("/") || /^[a-z]:/i.test(trimmed)) return null;
  const segments = trimmed.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === ".." || segment.startsWith("."))) return null;
  return segments.join("/");
}

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
    topics.push({ id: topic.id, title: topic.title, folder });
  }
  return topics;
}

export function serializeVaultTopics(topics: ReadonlyArray<MajordomeVaultTopic>): string {
  return `${JSON.stringify({ topics: topics.map(({ id, title, folder }) => ({ id, title, folder })) }, null, 2)}\n`;
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
}

/** Folder names that hold plumbing, periodic notes or old things, never a topic. */
const NOT_TOPIC_FOLDERS = new Set([
  "attachments",
  "assets",
  "images",
  "media",
  "archive",
  "archives",
  "done",
  "templates",
  "template",
  "weekly",
  "monthly",
  "node_modules",
]);

const SUGGESTION_LIMIT = 6;

/**
 * Up to six folders that look like topics, with human titles: the folders inside the projects
 * folder and other top-level containers (`personal/fitness`, `projects/lisbon-move`), then
 * top-level folders with notes and no subfolders. Daily, inbox, attachments, archive and template
 * folders are skipped, and so are folders with no notes and folders already in `taken`.
 */
export function suggestTopics(input: {
  readonly folders: ReadonlyArray<VaultFolder>;
  readonly layout: Pick<VaultLayout, "dailyFolder" | "inboxFolder" | "projectsFolder">;
  readonly taken: ReadonlySet<string>;
}): ReadonlyArray<MajordomeTopicSuggestion> {
  const skipped = new Set(
    [input.layout.dailyFolder, input.layout.inboxFolder].map((folder) => folder.toLowerCase()),
  );
  const isPlumbing = (folder: string) =>
    folder.split("/").some((segment) => {
      const name = segment.toLowerCase();
      return (
        NOT_TOPIC_FOLDERS.has(name) ||
        name.startsWith("_") ||
        name.startsWith(".") ||
        skipped.has(name)
      );
    }) || skipped.has(folder.toLowerCase());
  const usable = input.folders.filter(
    (folder) => !isPlumbing(folder.path) && !input.taken.has(folder.path),
  );
  const depth = (folder: string) => folder.split("/").length;
  const hasChildren = (folder: string) =>
    input.folders.some((other) => other.path.startsWith(`${folder}/`) && !isPlumbing(other.path));
  const withNotes = usable.filter((folder) => folder.notes > 0);
  const projectsFolder = normalizeTopicFolder(input.layout.projectsFolder);
  const inProjects = withNotes.filter(
    (folder) => depth(folder.path) === 2 && folder.path.split("/")[0] === projectsFolder,
  );
  const nested = withNotes.filter(
    (folder) => depth(folder.path) === 2 && folder.path.split("/")[0] !== projectsFolder,
  );
  const leaves = withNotes.filter(
    (folder) =>
      depth(folder.path) === 1 && folder.path !== projectsFolder && !hasChildren(folder.path),
  );
  return [...inProjects, ...nested, ...leaves]
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
  let level: Array<string> = [""];
  // One level deeper than listed, to count the notes in the deepest listed folders.
  for (let depth = 0; depth <= FOLDER_LIST_DEPTH && level.length > 0; depth += 1) {
    const next: Array<string> = [];
    for (const parent of level) {
      const entries = yield* fileSystem
        .readDirectoryEntries(parent === "" ? vaultRoot : path.join(vaultRoot, parent))
        .pipe(Effect.orElseSucceed((): ReadonlyArray<FileSystem.DirectoryEntry> => []));
      let notes = 0;
      for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
        if (!isListedName(entry.name)) continue;
        if (entry.type === "File" && entry.name.toLowerCase().endsWith(".md")) notes += 1;
        if (
          entry.type === "Directory" &&
          depth < FOLDER_LIST_DEPTH &&
          ownNotes.size + next.length < FOLDER_LIST_LIMIT
        ) {
          next.push(parent === "" ? entry.name : `${parent}/${entry.name}`);
        }
      }
      if (parent !== "") ownNotes.set(parent, notes);
    }
    level = next;
  }
  const folders = [...ownNotes.keys()];
  return folders.map((folder): VaultFolder => ({
    path: folder,
    notes: folders
      .filter((other) => other === folder || other.startsWith(`${folder}/`))
      .reduce((sum, other) => sum + (ownNotes.get(other) ?? 0), 0),
  }));
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

interface TopicNote {
  readonly path: string;
  readonly changedAt: number;
}

const listTopicNotes = Effect.fn("majordome.listTopicNotes")(function* (folderPath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const notes: Array<TopicNote> = [];
  let level: Array<string> = [""];
  for (let depth = 1; depth <= TOPIC_NOTE_DEPTH && level.length > 0; depth += 1) {
    const next: Array<string> = [];
    for (const parent of level) {
      const entries = yield* fileSystem
        .readDirectoryEntries(parent === "" ? folderPath : path.join(folderPath, parent))
        .pipe(Effect.orElseSucceed((): ReadonlyArray<FileSystem.DirectoryEntry> => []));
      for (const entry of entries) {
        if (!isListedName(entry.name) || notes.length >= TOPIC_NOTE_SCAN_LIMIT) continue;
        const relative = parent === "" ? entry.name : `${parent}/${entry.name}`;
        if (entry.type === "Directory") next.push(relative);
        else if (entry.type === "File" && entry.name.toLowerCase().endsWith(".md")) {
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
  return notes.toSorted((a, b) => b.changedAt - a.changedAt || a.path.localeCompare(b.path));
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
  const notes = yield* listTopicNotes(folderPath);
  const logPath = `${topic.folder}/log.md`;

  const opening = [
    `<topic title="${escapeAttribute(topic.title)}" folder="${escapeAttribute(topic.folder)}">`,
    `This conversation is the topic "${topic.title}". Its memory is the folder ${topic.folder}: keep its running log in ${logPath} (what was decided, done or learned, newest last), because this chat may be compacted or restarted.`,
  ].join("\n");
  const closing = "</topic>";

  const listingLines = notes.slice(0, NOTES_LISTING_LIMIT).map((note) => {
    const day = isoDay(note.changedAt);
    return day === null ? `- ${note.path}` : `- ${note.path} (changed ${day})`;
  });
  if (notes.length > NOTES_LISTING_LIMIT) {
    listingLines.push(`- …and ${notes.length - NOTES_LISTING_LIMIT} more`);
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
  const log = byName("log.md");
  if (log) picks.push({ note: log, limit: LOG_NOTE_LIMIT, cut: tail });
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
