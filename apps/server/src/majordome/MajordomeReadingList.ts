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
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
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
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { buildReadingEnrichmentPrompt, parseReadingEnrichment } from "./readingEnrichment.ts";
import { lookUpLink, normalizeLink, parseLink } from "./readingLink.ts";
import { readVaultLayout, VAULT_CONFIG_DIRNAME } from "./vaultConfig.ts";
import * as VaultLock from "./VaultLock.ts";

export class MajordomeReadingList extends Context.Service<
  MajordomeReadingList,
  {
    readonly list: (
      input: MajordomeReadingListInput,
    ) => Effect.Effect<MajordomeReadingListResult, MajordomeReadingListError>;
    /**
     * Saves a link or a title, first in the list. A link already saved is handed back instead, out
     * of the Trash if it was there. `mustLoad` refuses a link whose site says the page is gone.
     */
    readonly add: (
      input: MajordomeAddReadingItemInput,
      options?: { readonly mustLoad?: boolean },
    ) => Effect.Effect<MajordomeAddReadingItemResult, MajordomeReadingListError>;
    readonly update: (
      input: MajordomeUpdateReadingItemInput,
    ) => Effect.Effect<MajordomeReadingItem, MajordomeReadingListError>;
    readonly reorder: (
      input: MajordomeReorderReadingItemsInput,
    ) => Effect.Effect<void, MajordomeReadingListError>;
    /** Moves an item to the Trash; one already there is deleted for good. */
    readonly remove: (
      input: MajordomeReadingItemRefInput,
    ) => Effect.Effect<void, MajordomeReadingListError>;
    /** Takes an item out of the Trash, back where it was. */
    readonly restore: (
      input: MajordomeRestoreReadingItemInput,
    ) => Effect.Effect<void, MajordomeReadingListError>;
    /** Looks up the picture of every saved link that has none. `list` starts it by itself. */
    readonly fillPictures: (
      input: MajordomeReadingListInput,
    ) => Effect.Effect<void, MajordomeReadingListError>;
  }
>()("t3/majordome/MajordomeReadingList") {}

const READING_LIST_FILENAME = "reading-list.json";
/** A provider CLI takes a few seconds just to start; past this the link simply stays untagged. */
const ENRICHMENT_TIMEOUT = "30 seconds";

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

/** True for a real calendar date written `2026-12-02`. */
function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  // Read back, since a day that does not exist (30 February) can be read as one that does.
  return Option.match(DateTime.make(text), {
    onNone: () => false,
    onSome: (date) => DateTime.formatIsoDateUtc(date) === text,
  });
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
  const text = (sent: string | null | undefined, kept: string | undefined) =>
    sent === undefined ? kept : sent?.trim() ? sent.trim() : undefined;
  const notes =
    input.notes === undefined ? item.notes : input.notes?.trim() ? input.notes : undefined;
  const summary = text(input.summary, item.summary);
  const why = text(input.why, item.why);
  const starred = input.starred ?? item.starred;
  const doneAt =
    input.done === undefined ? item.doneAt : input.done ? (item.doneAt ?? now) : undefined;
  // Something finished has no place left to pick up from, and nothing to come back for.
  const progress = doneAt !== undefined ? undefined : text(input.progress, item.progress);
  const snoozedUntil =
    doneAt !== undefined
      ? undefined
      : input.snoozedUntil === undefined
        ? item.snoozedUntil
        : (input.snoozedUntil ?? undefined);
  return {
    id: item.id,
    url: item.url,
    title: input.title ?? item.title,
    ...(item.site === undefined ? {} : { site: item.site }),
    kind: input.kind ?? item.kind,
    tags: input.tags === undefined ? item.tags : normalizeTags(input.tags),
    ...(minutes === undefined ? {} : { minutes }),
    ...(summary === undefined ? {} : { summary }),
    ...(item.image === undefined ? {} : { image: item.image }),
    addedAt: item.addedAt,
    ...(doneAt === undefined ? {} : { doneAt }),
    ...(snoozedUntil === undefined ? {} : { snoozedUntil }),
    ...(starred === true ? { starred } : {}),
    ...(notes === undefined ? {} : { notes }),
    ...(why === undefined ? {} : { why }),
    ...(progress === undefined ? {} : { progress }),
    ...(item.deletedAt === undefined ? {} : { deletedAt: item.deletedAt }),
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
  const settings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  // One change at a time, so two quick edits never write over each other.
  const lock = yield* Semaphore.make(1);
  const serviceScope = yield* Effect.scope;
  // Vaults whose missing pictures were already looked for since the server started.
  const filled = new Set<string>();

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

  /** Tags and a summary from the owner's AI; null when it is not ready or its answer is unusable. */
  const describe = Effect.fn("MajordomeReadingList.describe")(
    function* (
      projectId: MajordomeReadingListInput["projectId"],
      request: Parameters<typeof buildReadingEnrichmentPrompt>[0],
    ) {
      // Providers run in a working directory; this one must not read or change the notes.
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-reading-" });
      const generated = yield* textGeneration.generateTranscriptionPostProcessing({
        cwd,
        prompt: buildReadingEnrichmentPrompt(request),
        modelSelection: resolveProjectSettings(yield* settings.getSettings, projectId).settings
          .textGenerationModelSelection,
      });
      return parseReadingEnrichment(generated.transcription);
    },
    Effect.scoped,
    Effect.timeoutOption(ENRICHMENT_TIMEOUT),
    Effect.map(Option.getOrNull),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logDebug("Reading list enrichment failed", { cause }).pipe(Effect.as(null)),
    ),
  );

  const toError = (message: string) => (cause: unknown) =>
    isReadingListError(cause) ? cause : new MajordomeReadingListError({ message, cause });

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const fillPictures: MajordomeReadingList["Service"]["fillPictures"] = Effect.fn(
    "MajordomeReadingList.fillPictures",
  )(
    function* (input) {
      const vaultRoot = yield* requireVaultRoot(input.projectId);
      // One page at a time, and outside the change, so a slow page never holds the list's lock.
      for (const item of (yield* read(vaultRoot)).items) {
        const link =
          item.image === undefined && item.deletedAt === undefined
            ? parseLink(item.url ?? "")
            : null;
        if (link === null) continue;
        const { image } = yield* lookUpLink(link, item.kind).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        if (image === undefined) continue;
        const lacksPicture = (candidate: MajordomeReadingItem) =>
          candidate.id === item.id && candidate.image === undefined;
        yield* change(vaultRoot, (file) =>
          Effect.succeed(
            file.items.some(lacksPicture)
              ? {
                  items: file.items.map((candidate) =>
                    lacksPicture(candidate) ? { ...candidate, image } : candidate,
                  ),
                  result: undefined,
                }
              : { result: undefined },
          ),
        );
      }
    },
    Effect.mapError(toError("Could not look up your reading list's pictures.")),
  );

  const list: MajordomeReadingList["Service"]["list"] = Effect.fn("MajordomeReadingList.list")(
    function* (input) {
      const vaultRoot = yield* vaultRootOf(input.projectId);
      if (vaultRoot === undefined) return { isVault: false, items: [] };
      const { items } = yield* read(vaultRoot);
      // Once per start: links saved before pictures were kept, or while their page was down.
      if (!filled.has(vaultRoot)) {
        filled.add(vaultRoot);
        yield* fillPictures(input).pipe(Effect.ignore, Effect.forkIn(serviceScope));
      }
      return { isVault: true, items };
    },
    Effect.mapError(toError("Could not read your reading list.")),
  );

  const add: MajordomeReadingList["Service"]["add"] = Effect.fn("MajordomeReadingList.add")(
    function* (input, options) {
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
      /** The saved one as the answer, taken out of the Trash when that is where it was. */
      const handBack = (
        existing: MajordomeReadingItem,
        items: ReadonlyArray<MajordomeReadingItem>,
      ) => {
        const { deletedAt: _, ...item } = existing;
        return {
          ...(existing.deletedAt === undefined
            ? {}
            : { items: items.map((candidate) => (candidate === existing ? item : candidate)) }),
          result: { item, duplicate: true },
        };
      };
      // Looked for before the page is fetched too, so saving a link twice answers at once.
      const already = saved((yield* read(vaultRoot)).items);
      if (already !== undefined && already.deletedAt === undefined) {
        return { item: already, duplicate: true };
      }
      const details =
        link === null
          ? undefined
          : yield* lookUpLink(link).pipe(Effect.provideService(HttpClient.HttpClient, http));
      if (options?.mustLoad === true && details?.missing === true) {
        return yield* fail("That link does not open: its site says there is no such page.");
      }
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
            : handBack(existing, file.items),
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
      if (typeof input.snoozedUntil === "string" && !isCalendarDate(input.snoozedUntil)) {
        return yield* fail("That is not a day this can be snoozed until.");
      }
      const now = yield* nowIso;
      // Read and described outside the change, so a slow page or model never holds the list's lock.
      const before =
        input.lookUp === true || input.enrich === true ? (yield* read(vaultRoot)).items : [];
      const target = before.find((item) => item.id === input.itemId);
      const link = target === undefined ? null : parseLink(target.url ?? "");
      const found =
        link === null
          ? undefined
          : yield* lookUpLink(link, input.kind ?? target?.kind).pipe(
              Effect.provideService(HttpClient.HttpClient, http),
            );
      const described =
        input.enrich === true && target !== undefined
          ? yield* describe(input.projectId, {
              title: target.title,
              site: target.site ?? found?.site,
              kind: target.kind,
              excerpt: found?.excerpt,
              knownTags: [...new Set(before.flatMap((item) => item.tags))],
            })
          : null;
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
        // What the owner tagged or the list already says stays; the AI only fills what is empty.
        const enriched: MajordomeReadingItem =
          described === null
            ? next
            : {
                ...next,
                ...(next.tags.length === 0 && described.tags.length > 0
                  ? { tags: normalizeTags(described.tags) }
                  : {}),
                ...(next.summary === undefined && described.summary !== undefined
                  ? { summary: described.summary }
                  : {}),
              };
        return Effect.succeed({
          items: file.items.map((candidate) => (candidate === item ? enriched : candidate)),
          result: enriched,
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
      const deletedAt = yield* nowIso;
      yield* change(vaultRoot, (file) => {
        const item = file.items.find((candidate) => candidate.id === input.itemId);
        if (item === undefined) return Effect.succeed({ result: undefined });
        return Effect.succeed({
          items:
            item.deletedAt === undefined
              ? file.items.map((candidate) =>
                  candidate === item ? { ...item, deletedAt } : candidate,
                )
              : file.items.filter((candidate) => candidate !== item),
          result: undefined,
        });
      });
    },
    Effect.mapError(toError("Could not remove this item.")),
  );

  const restore: MajordomeReadingList["Service"]["restore"] = Effect.fn(
    "MajordomeReadingList.restore",
  )(
    function* (input) {
      const vaultRoot = yield* requireVaultRoot(input.projectId);
      yield* change(vaultRoot, (file) => {
        const item = file.items.find((candidate) => candidate.id === input.itemId);
        if (item === undefined) return fail("That item is no longer in the Trash.");
        if (item.deletedAt === undefined) return Effect.succeed({ result: undefined });
        const { deletedAt: _, ...kept } = item;
        return Effect.succeed({
          items: file.items.map((candidate) => (candidate === item ? kept : candidate)),
          result: undefined,
        });
      });
    },
    Effect.mapError(toError("Could not put this item back.")),
  );

  return MajordomeReadingList.of({ list, add, update, reorder, remove, restore, fillPictures });
});

export const layer = Layer.effect(MajordomeReadingList, make);
