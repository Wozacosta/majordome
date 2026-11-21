/**
 * The owner's reading list: things saved to read, watch or listen to later. It lives in the vault,
 * `.majordome/reading-list.json`, so it travels with the notes and the assistant can edit it by
 * hand. The file's order is the owner's.
 */

import {
  type MajordomeAddReadingItemInput,
  type MajordomeAddReadingItemResult,
  MajordomeReadingItem,
  type MajordomeReadingItemRefInput,
  MajordomeReadingListError,
  type MajordomeReadingListInput,
  type MajordomeReadingListResult,
  type MajordomeReorderReadingItemsInput,
  type MajordomeRestoreReadingItemInput,
  type MajordomeUpdateReadingItemInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/http";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { lookUpLink, normalizeLink, parseLink } from "./readingLink.ts";
import { readVaultLayout, VAULT_CONFIG_DIRNAME } from "./vaultConfig.ts";
import * as VaultLock from "./VaultLock.ts";

export class MajordomeReadingList extends Context.Service<
  MajordomeReadingList,
  {
    readonly list: (
      input: MajordomeReadingListInput,
    ) => Effect.Effect<MajordomeReadingListResult, MajordomeReadingListError>;
    /** Saves a link or a title, first in the list. A link already saved is handed back instead. */
    readonly add: (
      input: MajordomeAddReadingItemInput,
    ) => Effect.Effect<MajordomeAddReadingItemResult, MajordomeReadingListError>;
    readonly update: (
      input: MajordomeUpdateReadingItemInput,
    ) => Effect.Effect<MajordomeReadingItem, MajordomeReadingListError>;
    readonly reorder: (
      input: MajordomeReorderReadingItemsInput,
    ) => Effect.Effect<void, MajordomeReadingListError>;
    readonly remove: (
      input: MajordomeReadingItemRefInput,
    ) => Effect.Effect<void, MajordomeReadingListError>;
    /** Puts a removed item back where it was. */
    readonly restore: (
      input: MajordomeRestoreReadingItemInput,
    ) => Effect.Effect<void, MajordomeReadingListError>;
  }
>()("t3/majordome/MajordomeReadingList") {}

const READING_LIST_FILENAME = "reading-list.json";

const isReadingListError = Schema.is(MajordomeReadingListError);
const decodeItem = Schema.decodeUnknownOption(MajordomeReadingItem);

const fail = (message: string) => Effect.fail(new MajordomeReadingListError({ message }));

interface ReadingListFile {
  readonly items: ReadonlyArray<MajordomeReadingItem>;
  /** Entries that are not items (a hand edit gone wrong), kept so a save never deletes them. */
  readonly unreadable: ReadonlyArray<unknown>;
}

const EMPTY_FILE: ReadingListFile = { items: [], unreadable: [] };

/** The items a `reading-list.json` holds, in its order; null when it is not a list at all. */
function parseReadingList(text: string): ReadingListFile | null {
  if (text.trim() === "") return EMPTY_FILE;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || !("items" in raw) || !Array.isArray(raw.items)) {
    return null;
  }
  const seen = new Set<string>();
  const items: Array<MajordomeReadingItem> = [];
  const unreadable: Array<unknown> = [];
  for (const entry of raw.items as ReadonlyArray<unknown>) {
    const item = Option.getOrUndefined(decodeItem(entry));
    if (item === undefined || seen.has(item.id)) {
      unreadable.push(entry);
      continue;
    }
    seen.add(item.id);
    items.push(item);
  }
  return { items, unreadable };
}

function serializeReadingList(file: ReadingListFile): string {
  return `${JSON.stringify({ items: [...file.items, ...file.unreadable] }, null, 2)}\n`;
}

function normalizeTags(tags: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== ""))];
}

/** `item` with the fields `input` sends changed; `now` dates a newly finished one. */
function applyReadingItemUpdate(
  item: MajordomeReadingItem,
  input: Omit<MajordomeUpdateReadingItemInput, "projectId" | "itemId">,
  now: string,
): MajordomeReadingItem {
  const minutes = input.minutes === undefined ? item.minutes : (input.minutes ?? undefined);
  const notes =
    input.notes === undefined ? item.notes : input.notes?.trim() ? input.notes : undefined;
  const starred = input.starred ?? item.starred;
  const doneAt =
    input.done === undefined ? item.doneAt : input.done ? (item.doneAt ?? now) : undefined;
  return {
    id: item.id,
    url: item.url,
    title: input.title ?? item.title,
    ...(item.site === undefined ? {} : { site: item.site }),
    kind: input.kind ?? item.kind,
    tags: input.tags === undefined ? item.tags : normalizeTags(input.tags),
    ...(minutes === undefined ? {} : { minutes }),
    ...(item.image === undefined ? {} : { image: item.image }),
    addedAt: item.addedAt,
    ...(doneAt === undefined ? {} : { doneAt }),
    ...(starred === true ? { starred } : {}),
    ...(notes === undefined ? {} : { notes }),
  };
}

/** The items in the order of `ids`; ones it leaves out keep their order at the end. */
function reorderReadingItems(
  items: ReadonlyArray<MajordomeReadingItem>,
  ids: ReadonlyArray<string>,
): ReadonlyArray<MajordomeReadingItem> {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const ordered: Array<MajordomeReadingItem> = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item === undefined) continue;
    ordered.push(item);
    byId.delete(id);
  }
  return [...ordered, ...items.filter((item) => byId.has(item.id))];
}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const vaultLock = yield* VaultLock.VaultLock;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const http = yield* HttpClient.HttpClient;
  // One change at a time, so two quick edits never write over each other.
  const lock = yield* Semaphore.make(1);

  const filePath = (vaultRoot: string) =>
    path.join(vaultRoot, VAULT_CONFIG_DIRNAME, READING_LIST_FILENAME);

  const vaultRootOf = Effect.fn("MajordomeReadingList.vaultRootOf")(function* (
    projectId: MajordomeReadingListInput["projectId"],
  ) {
    const project = Option.getOrUndefined(yield* projects.get(projectId));
    if (project === undefined) return undefined;
    const layout = yield* readVaultLayout(project.workspaceRoot).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    return Option.isSome(layout) ? project.workspaceRoot : undefined;
  });

  const requireVaultRoot = (projectId: MajordomeReadingListInput["projectId"]) =>
    vaultRootOf(projectId).pipe(
      Effect.filterOrFail(
        (vaultRoot) => vaultRoot !== undefined,
        () => new MajordomeReadingListError({ message: "That notes folder was not found." }),
      ),
    );

  const read = Effect.fn("MajordomeReadingList.read")(function* (vaultRoot: string) {
    const target = filePath(vaultRoot);
    if (!(yield* fileSystem.exists(target))) return EMPTY_FILE;
    const file = parseReadingList(yield* fileSystem.readFileString(target));
    // Failing here keeps a save from replacing a file that only has a typo in it.
    if (file === null) return yield* fail("Could not read your reading list.");
    return file;
  });

  /** Reads the list and, when `apply` gives new items, saves them: all under both locks. */
  const change = <A>(
    vaultRoot: string,
    apply: (
      file: ReadingListFile,
    ) => Effect.Effect<
      { readonly items?: ReadonlyArray<MajordomeReadingItem>; readonly result: A },
      MajordomeReadingListError
    >,
  ) =>
    lock.withPermits(1)(
      vaultLock.withLock(
        vaultRoot,
        Effect.gen(function* () {
          const file = yield* read(vaultRoot);
          const { items, result } = yield* apply(file);
          if (items === undefined) return result;
          const target = filePath(vaultRoot);
          const temp = `${target}.${yield* random.uuidV4()}.tmp`;
          yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
          yield* fileSystem.writeFileString(temp, serializeReadingList({ ...file, items }));
          yield* fileSystem.rename(temp, target);
          return result;
        }),
      ),
    );

  const toError = (message: string) => (cause: unknown) =>
    isReadingListError(cause) ? cause : new MajordomeReadingListError({ message, cause });

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const list: MajordomeReadingList["Service"]["list"] = Effect.fn("MajordomeReadingList.list")(
    function* (input) {
      const vaultRoot = yield* vaultRootOf(input.projectId);
      if (vaultRoot === undefined) return { isVault: false, items: [] };
      return { isVault: true, items: (yield* read(vaultRoot)).items };
    },
    Effect.mapError(toError("Could not read your reading list.")),
  );

  const add: MajordomeReadingList["Service"]["add"] = Effect.fn("MajordomeReadingList.add")(
    function* (input) {
      const vaultRoot = yield* requireVaultRoot(input.projectId);
      const link = parseLink(input.text);
      const saved = (items: ReadonlyArray<MajordomeReadingItem>) => {
        if (link === null) return undefined;
        const wanted = normalizeLink(link);
        return items.find((item) => {
          const url = item.url === null ? null : parseLink(item.url);
          return url !== null && normalizeLink(url) === wanted;
        });
      };
      // Looked for before the page is fetched too, so saving a link twice answers at once.
      const already = saved((yield* read(vaultRoot)).items);
      if (already !== undefined) return { item: already, duplicate: true };
      const details =
        link === null
          ? undefined
          : yield* lookUpLink(link).pipe(Effect.provideService(HttpClient.HttpClient, http));
      const item: MajordomeReadingItem = {
        id: `itm-${yield* random.uuidV4()}`,
        url: link === null ? null : link.href,
        title: details?.title ?? input.text,
        ...(details === undefined ? {} : { site: details.site }),
        kind: details?.kind ?? "other",
        tags: [],
        ...(details?.minutes === undefined ? {} : { minutes: details.minutes }),
        ...(details?.image === undefined ? {} : { image: details.image }),
        addedAt: yield* nowIso,
      };
      return yield* change(vaultRoot, (file) => {
        const existing = saved(file.items);
        return Effect.succeed(
          existing === undefined
            ? { items: [item, ...file.items], result: { item, duplicate: false } }
            : { result: { item: existing, duplicate: true } },
        );
      });
    },
    Effect.mapError(toError("Could not save this to your reading list.")),
  );

  const update: MajordomeReadingList["Service"]["update"] = Effect.fn(
    "MajordomeReadingList.update",
  )(
    function* (input) {
      const vaultRoot = yield* requireVaultRoot(input.projectId);
      const now = yield* nowIso;
      // Read outside the change, so a slow page never holds the list's lock.
      const link =
        input.lookUp === true
          ? parseLink(
              (yield* read(vaultRoot)).items.find((item) => item.id === input.itemId)?.url ?? "",
            )
          : null;
      const found =
        link === null
          ? undefined
          : yield* lookUpLink(link).pipe(Effect.provideService(HttpClient.HttpClient, http));
      return yield* change(vaultRoot, (file) => {
        const item = file.items.find((candidate) => candidate.id === input.itemId);
        if (item === undefined) return fail("That item is no longer on your list.");
        const updated = applyReadingItemUpdate(item, input, now);
        // The owner's title and length stay theirs; a new look only fills what is missing.
        const next: MajordomeReadingItem =
          found === undefined
            ? updated
            : {
                ...updated,
                ...(updated.site === undefined ? { site: found.site } : {}),
                ...(updated.minutes === undefined && found.minutes !== undefined
                  ? { minutes: found.minutes }
                  : {}),
                ...(found.image === undefined ? {} : { image: found.image }),
              };
        return Effect.succeed({
          items: file.items.map((candidate) => (candidate === item ? next : candidate)),
          result: next,
        });
      });
    },
    Effect.mapError(toError("Could not change this item.")),
  );

  const reorder: MajordomeReadingList["Service"]["reorder"] = Effect.fn(
    "MajordomeReadingList.reorder",
  )(
    function* (input) {
      const vaultRoot = yield* requireVaultRoot(input.projectId);
      yield* change(vaultRoot, (file) =>
        Effect.succeed({
          items: reorderReadingItems(file.items, input.itemIds),
          result: undefined,
        }),
      );
    },
    Effect.mapError(toError("Could not reorder your reading list.")),
  );

  const remove: MajordomeReadingList["Service"]["remove"] = Effect.fn(
    "MajordomeReadingList.remove",
  )(
    function* (input) {
      const vaultRoot = yield* requireVaultRoot(input.projectId);
      yield* change(vaultRoot, (file) =>
        Effect.succeed(
          file.items.some((item) => item.id === input.itemId)
            ? {
                items: file.items.filter((item) => item.id !== input.itemId),
                result: undefined,
              }
            : { result: undefined },
        ),
      );
    },
    Effect.mapError(toError("Could not remove this item.")),
  );

  const restore: MajordomeReadingList["Service"]["restore"] = Effect.fn(
    "MajordomeReadingList.restore",
  )(
    function* (input) {
      const vaultRoot = yield* requireVaultRoot(input.projectId);
      yield* change(vaultRoot, (file) => {
        if (file.items.some((item) => item.id === input.item.id)) {
          return Effect.succeed({ result: undefined });
        }
        const index = Number.isFinite(input.index)
          ? Math.min(Math.max(Math.trunc(input.index), 0), file.items.length)
          : file.items.length;
        return Effect.succeed({
          items: [...file.items.slice(0, index), input.item, ...file.items.slice(index)],
          result: undefined,
        });
      });
    },
    Effect.mapError(toError("Could not put this item back.")),
  );

  return MajordomeReadingList.of({ list, add, update, reorder, remove, restore });
});

export const layer = Layer.effect(MajordomeReadingList, make);
