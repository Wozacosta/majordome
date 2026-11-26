import type { EnvironmentId, MajordomeLibraryFile, ProjectId, ThreadId } from "@t3tools/contracts";

import type { VaultTopic } from "./topics.logic";

export type LibraryType = "image" | "document" | "code" | "spreadsheet" | "media" | "other";

/** The tabs, in the order they are offered. */
export const LIBRARY_TYPE_LABELS: ReadonlyArray<readonly [LibraryType, string]> = [
  ["image", "Images"],
  ["document", "Documents"],
  ["code", "Code"],
  ["spreadsheet", "Spreadsheets"],
  ["media", "Audio and video"],
  ["other", "Other"],
];

const EXTENSIONS: Readonly<Record<Exclude<LibraryType, "other">, ReadonlyArray<string>>> = {
  image: [
    "avif",
    "bmp",
    "gif",
    "heic",
    "heif",
    "ico",
    "jpeg",
    "jpg",
    "png",
    "svg",
    "tif",
    "tiff",
    "webp",
  ],
  document: [
    "doc",
    "docx",
    "epub",
    "key",
    "odp",
    "odt",
    "pages",
    "pdf",
    "ppt",
    "pptx",
    "rtf",
    "txt",
  ],
  code: [
    "c",
    "cpp",
    "cs",
    "css",
    "go",
    "h",
    "html",
    "java",
    "js",
    "json",
    "jsx",
    "kt",
    "php",
    "py",
    "rb",
    "rs",
    "sh",
    "sql",
    "swift",
    "toml",
    "ts",
    "tsx",
    "xml",
    "yaml",
    "yml",
  ],
  spreadsheet: ["csv", "numbers", "ods", "tsv", "xls", "xlsx"],
  media: ["aac", "avi", "flac", "m4a", "m4v", "mkv", "mov", "mp3", "mp4", "ogg", "wav", "webm"],
};

const TYPE_BY_EXTENSION = new Map(
  Object.entries(EXTENSIONS).flatMap(([type, extensions]) =>
    extensions.map((extension) => [extension, type as LibraryType] as const),
  ),
);

/** What a browser draws in an `<img>`; a HEIC or TIFF picture gets a card instead. */
const THUMBNAIL_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The tab a file goes under: by its name's ending, else by what the chat said it was. */
export function libraryType(name: string, mimeType?: string): LibraryType {
  const known = TYPE_BY_EXTENSION.get(extensionOf(name));
  if (known !== undefined) return known;
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("audio/") || mimeType?.startsWith("video/")) return "media";
  return "other";
}

/** The few letters on a card's badge: "PDF", "XLSX"; "FILE" for a name with no usable ending. */
export function libraryBadge(name: string): string {
  const extension = extensionOf(name);
  return /^[a-z0-9]{1,4}$/.test(extension) ? extension.toUpperCase() : "FILE";
}

export interface LibraryItem {
  readonly key: string;
  /** The server that holds the file. */
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly sizeBytes: number;
  readonly at: string;
  readonly type: LibraryType;
  /** True for a picture the grid can show as itself. */
  readonly thumbnail: boolean;
  readonly topicId: string | null;
  readonly origin:
    | { readonly kind: "notes"; readonly path: string }
    | {
        readonly kind: "chat";
        readonly attachmentId: string;
        readonly mimeType: string;
        readonly threadId: ThreadId;
        readonly threadTitle: string;
      };
}

type LibraryTopic = Pick<
  VaultTopic,
  "id" | "folder" | "threadId" | "threadEnvironmentId" | "sideChats" | "otherChats"
>;

/** The topic whose folder holds the file: the deepest one, where one topic's folder is in another's. */
function topicOfPath(path: string, topics: ReadonlyArray<LibraryTopic>): string | null {
  let best: LibraryTopic | null = null;
  for (const topic of topics) {
    if (!path.startsWith(`${topic.folder}/`)) continue;
    if (best === null || topic.folder.length > best.folder.length) best = topic;
  }
  return best?.id ?? null;
}

/** The topic a chat is about: its own conversation, or one of the chats listed under it. */
function topicOfChat(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  topics: ReadonlyArray<LibraryTopic>,
): string | null {
  const isIt = (chat: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId }) =>
    chat.environmentId === environmentId && chat.threadId === threadId;
  return (
    topics.find(
      (topic) =>
        (topic.threadId === threadId && topic.threadEnvironmentId === environmentId) ||
        (topic.sideChats ?? []).some(isIt) ||
        (topic.otherChats ?? []).some(isIt),
    )?.id ?? null
  );
}

/**
 * Every server's answer as one list, newest first. A brain's notes are the same on each of its
 * servers, so `copies` holds the whole answer of one and the chats of the others.
 */
export function libraryItems(
  copies: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly files: ReadonlyArray<MajordomeLibraryFile>;
  }>,
  topics: ReadonlyArray<LibraryTopic>,
): ReadonlyArray<LibraryItem> {
  const items = copies.flatMap(({ environmentId, projectId, files }) =>
    files.map((file): LibraryItem => {
      const type = libraryType(file.name, file._tag === "chat-file" ? file.mimeType : undefined);
      const shared = {
        environmentId,
        projectId,
        name: file.name,
        sizeBytes: file.sizeBytes,
        at: file.at,
        type,
        thumbnail:
          type === "image" &&
          (THUMBNAIL_EXTENSIONS.has(extensionOf(file.name)) ||
            (file._tag === "chat-file" &&
              TYPE_BY_EXTENSION.get(extensionOf(file.name)) !== "image")),
      };
      return file._tag === "notes-file"
        ? {
            ...shared,
            key: `notes:${environmentId}:${file.path}`,
            topicId: topicOfPath(file.path, topics),
            origin: { kind: "notes", path: file.path },
          }
        : {
            ...shared,
            key: `chat:${environmentId}:${file.attachmentId}`,
            topicId: topicOfChat(environmentId, file.threadId, topics),
            origin: {
              kind: "chat",
              attachmentId: file.attachmentId,
              mimeType: file.mimeType,
              threadId: file.threadId,
              threadTitle: file.threadTitle,
            },
          };
    }),
  );
  return items.toSorted(
    (left, right) => right.at.localeCompare(left.at) || left.name.localeCompare(right.name),
  );
}

/** Which files the left list narrows to: all of them, those of no topic, or `topic:<id>`. */
export type LibraryPlace = "all" | "none" | `topic:${string}`;

export const topicPlace = (topicId: string): LibraryPlace => `topic:${topicId}`;

const placeOf = (item: LibraryItem): LibraryPlace =>
  item.topicId === null ? "none" : topicPlace(item.topicId);

/** Lower case and without accents, so "resume" finds "Résumé.pdf". */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export interface LibraryView {
  /** The places that hold something the search finds, each with how many; "all" always first. */
  readonly places: ReadonlyArray<{ readonly place: LibraryPlace; readonly count: number }>;
  /** The types the chosen place holds, each with how many; "all" always first. */
  readonly tabs: ReadonlyArray<{ readonly type: LibraryType | "all"; readonly count: number }>;
  /** The chosen place and type, or "all" where the choice no longer holds anything. */
  readonly place: LibraryPlace;
  readonly type: LibraryType | "all";
  readonly shown: ReadonlyArray<LibraryItem>;
}

/**
 * What the page shows for a search, a place and a type. The search narrows the places' counts,
 * the place narrows the tabs' counts, and a choice left empty by the one before it falls back to
 * "all" so the page never sits on a filter nothing can clear.
 */
export function libraryView(
  items: ReadonlyArray<LibraryItem>,
  topics: ReadonlyArray<Pick<VaultTopic, "id">>,
  choice: {
    readonly query: string;
    readonly place: LibraryPlace;
    readonly type: LibraryType | "all";
  },
): LibraryView {
  const query = fold(choice.query.trim());
  const found = query === "" ? items : items.filter((item) => fold(item.name).includes(query));

  const perPlace = new Map<LibraryPlace, number>();
  for (const item of found) perPlace.set(placeOf(item), (perPlace.get(placeOf(item)) ?? 0) + 1);
  const places: Array<LibraryView["places"][number]> = [{ place: "all", count: found.length }];
  // In the owner's order; a topic since removed from the list still counts as no topic.
  for (const topic of topics) {
    const count = perPlace.get(topicPlace(topic.id)) ?? 0;
    if (count > 0) places.push({ place: topicPlace(topic.id), count });
  }
  const listed = new Set(places.map(({ place }) => place));
  const elsewhere = found.filter((item) => !listed.has(placeOf(item)));
  if (elsewhere.length > 0 && places.length > 1) {
    places.push({ place: "none", count: elsewhere.length });
  }

  const place = places.some((candidate) => candidate.place === choice.place) ? choice.place : "all";
  const inPlace =
    place === "all"
      ? found
      : place === "none"
        ? elsewhere
        : found.filter((item) => placeOf(item) === place);

  const perType = new Map<LibraryType, number>();
  for (const item of inPlace) perType.set(item.type, (perType.get(item.type) ?? 0) + 1);
  const tabs: Array<LibraryView["tabs"][number]> = [{ type: "all", count: inPlace.length }];
  for (const [type] of LIBRARY_TYPE_LABELS) {
    const count = perType.get(type) ?? 0;
    if (count > 0) tabs.push({ type, count });
  }

  const type = perType.has(choice.type as LibraryType) ? choice.type : "all";
  return {
    places,
    tabs,
    place,
    type,
    shown: type === "all" ? inPlace : inPlace.filter((item) => item.type === type),
  };
}

/** Where a file came from, in a few words: its topic, else its chat or its folder. */
export function libraryWhere(
  item: LibraryItem,
  topics: ReadonlyArray<Pick<VaultTopic, "id" | "title">>,
): string {
  const topic = topics.find((candidate) => candidate.id === item.topicId);
  if (topic !== undefined) return topic.title;
  if (item.origin.kind === "chat") return item.origin.threadTitle;
  const folder = item.origin.path.split("/").slice(0, -1).join("/");
  return folder === "" ? "Notes" : folder;
}
