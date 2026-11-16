/**
 * Search inside a vault's notes: the "searched" memory layer. Each vault has a full-text index in
 * its own SQLite file under the server's state directory, never in the notes folder or its git
 * history. The file is disposable: a missing, damaged or older one is deleted and built again
 * from the notes.
 */

// @effect-diagnostics-next-line nodeBuiltinImport:off -- Synchronous digests name the index file and fingerprint each note.
import * as NodeCrypto from "node:crypto";

import {
  type MajordomeNotesIndexInput,
  type MajordomeNotesIndexResult,
  type MajordomeNotesIndexStatus,
  MajordomeNotesSearchError,
  type MajordomeNotesSearchHit,
  type MajordomeNotesSearchInput,
  type MajordomeNotesSearchResult,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { forkParked } from "../serverActivation.ts";
import {
  headingAt,
  isNoteFile,
  isSkippedEntry,
  normalizeFolder,
  NOTE_MAX_BYTES,
  notesMatchQuery,
  readNote,
  shapeSnippet,
  SNIPPET_LEAD,
  SNIPPET_WINDOW,
} from "./notesIndex.ts";

/** Bumped when the tables or what they hold change; an index of another version is rebuilt. */
export const NOTES_INDEX_VERSION = 1;
const DEFAULT_RESULT_LIMIT = 20;
/** Edits no signal reported (a pull from another machine, Obsidian while no window is open). */
const RECONCILE_INTERVAL = "5 minutes";
const WRITE_BATCH = 100;
const READ_CONCURRENCY = 8;
const STAT_CONCURRENCY = 16;
const MAX_FOLDER_DEPTH = 32;
// Path, title, headings, body: a word in a note's name or title outranks one in its text.
const RANK = "bm25(6.0, 10.0, 4.0, 1.0)";

/** What one pass over a vault did, in files. */
export interface NotesIndexPass {
  /** Notes found in the folder. */
  readonly scanned: number;
  /** Notes read because their size or modified time changed. */
  readonly read: number;
  /** Notes whose text went into the index. */
  readonly indexed: number;
  readonly removed: number;
}

class NotesIndexError extends Schema.TaggedError<NotesIndexError>()("NotesIndexError", {
  stage: Schema.Literals(["open", "scan", "write", "query"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `The notes index failed at ${this.stage}.`;
  }
}

const isNotesIndexError = Schema.is(NotesIndexError);

const STAGE_REASONS: Record<NotesIndexError["stage"], string> = {
  open: "The search index could not be opened.",
  scan: "The notes folder could not be read.",
  write: "The search index could not be saved.",
  query: "The search index could not be read.",
};

const FileRow = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  mtimeMs: Schema.Number,
  size: Schema.Number,
  hash: Schema.String,
});

const HitRow = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  mtimeMs: Schema.Number,
  headings: Schema.fromJsonString(
    Schema.Array(Schema.Struct({ offset: Schema.Number, text: Schema.String })),
  ),
  matchAt: Schema.Number,
  markedLength: Schema.Number,
  window: Schema.String,
});
const decodeFileRows = Schema.decodeUnknownEffect(Schema.Array(FileRow));
const decodeHitRows = Schema.decodeUnknownEffect(Schema.Array(HitRow));

const BUILDING: MajordomeNotesIndexStatus = {
  state: "building",
  noteCount: 0,
  lastIndexedAt: null,
};

const isoTime = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

interface OpenIndex {
  readonly sql: SqlClient.SqlClient;
  readonly close: Effect.Effect<void>;
}

export class MajordomeNotesSearch extends Context.Service<
  MajordomeNotesSearch,
  {
    /** Answers from the index as it is, and never waits for indexing. */
    readonly search: (
      input: MajordomeNotesSearchInput,
    ) => Effect.Effect<MajordomeNotesSearchResult, MajordomeNotesSearchError>;
    /**
     * For an agent: the notes of its thread's vault, after picking up what changed on disk, so a
     * run finds what it wrote a moment ago.
     */
    readonly searchForThread: (input: {
      readonly threadId: ThreadId;
      readonly query: string;
      readonly folder?: string | undefined;
      readonly limit?: number | undefined;
    }) => Effect.Effect<MajordomeNotesSearchResult, MajordomeNotesSearchError>;
    readonly status: (
      input: MajordomeNotesIndexInput,
    ) => Effect.Effect<MajordomeNotesIndexResult, MajordomeNotesSearchError>;
    /** Throws the index away and builds it again, for when results look wrong. */
    readonly rebuild: (
      input: MajordomeNotesIndexInput,
    ) => Effect.Effect<MajordomeNotesIndexResult, MajordomeNotesSearchError>;
    /**
     * Brings a vault's index up to date with its folder: reads only notes whose size or modified
     * time changed. Null when the folder is not a vault or the pass failed. Calls made while one
     * pass waits share it.
     */
    readonly refresh: (vaultRoot: string) => Effect.Effect<NotesIndexPass | null>;
    /** `refresh` without the wait, for whoever sees a vault change: a run ending, a watcher. */
    readonly refreshInBackground: (vaultRoot: string) => Effect.Effect<void>;
    /** Indexes every vault in the background, now and then on a slow interval. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/majordome/MajordomeNotesSearch") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const indexDir = path.join((yield* ServerConfig.ServerConfig).stateDir, "notes-search");
  const serviceScope = yield* Effect.scope;
  // One pass or rebuild per vault at a time; searches never take it.
  const passLock = yield* KeyedLock.make<string>();
  const indexes = new Map<string, OpenIndex>();
  const statuses = new Map<string, MajordomeNotesIndexStatus>();
  // Per vault: refresh calls made, and the count when the latest pass started.
  const requested = new Map<string, number>();
  const covered = new Map<string, number>();

  const indexFile = (vaultRoot: string) =>
    path.join(
      indexDir,
      `${NodeCrypto.createHash("sha256").update(vaultRoot).digest("hex").slice(0, 24)}.sqlite`,
    );

  const removeIndexFile = (file: string) =>
    Effect.forEach(
      [file, `${file}-wal`, `${file}-shm`],
      (target) => fileSystem.remove(target, { force: true }).pipe(Effect.ignore),
      { discard: true },
    );

  const openFile = Effect.fn("MajordomeNotesSearch.openFile")(function* (file: string) {
    const scope = yield* Scope.fork(serviceScope);
    const close = Scope.close(scope, Exit.void);
    return yield* Effect.gen(function* () {
      const context = yield* Layer.buildWithScope(
        // Workers keep a large first pass, and every search, off the server's event loop.
        NodeSqliteClient.layer({ filename: file, readerWorker: true, writerWorker: true }),
        scope,
      );
      const sql = Context.get(context, SqlClient.SqlClient);
      yield* sql`PRAGMA journal_mode = WAL`;
      yield* sql`PRAGMA synchronous = NORMAL`;
      const version = (yield* sql<{ readonly user_version: number }>`PRAGMA user_version`)[0]
        ?.user_version;
      const tables = yield* sql`SELECT 1 FROM sqlite_schema LIMIT 1`;
      if (tables.length === 0) {
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`
              CREATE TABLE files (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                mtime_ms INTEGER NOT NULL,
                size INTEGER NOT NULL,
                hash TEXT NOT NULL,
                headings TEXT NOT NULL
              )
            `;
            yield* sql`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
            // Whole words with accents folded ("ete" finds "été"), and short prefixes indexed
            // for search-as-you-type.
            yield* sql`
              CREATE VIRTUAL TABLE notes USING fts5(
                path, title, headings, body,
                tokenize = 'unicode61 remove_diacritics 2',
                prefix = '2 3'
              )
            `;
            yield* sql`INSERT INTO notes (notes, rank) VALUES ('rank', ${RANK})`;
            yield* sql.unsafe(`PRAGMA user_version = ${NOTES_INDEX_VERSION}`);
          }),
        );
        return { index: { sql, close }, fresh: true };
      }
      if (version !== NOTES_INDEX_VERSION) {
        return yield* new NotesIndexError({ stage: "open", cause: `version ${version}` });
      }
      const indexedAt = yield* sql<{ readonly value: string }>`
        SELECT value FROM meta WHERE key = 'last_indexed_at'
      `;
      return { index: { sql, close }, fresh: indexedAt.length === 0 };
    }).pipe(
      Effect.mapError((cause) =>
        isNotesIndexError(cause) ? cause : new NotesIndexError({ stage: "open", cause }),
      ),
      Effect.onError(() => close),
    );
  });

  const readStatus = Effect.fn("MajordomeNotesSearch.readStatus")(function* (
    sql: SqlClient.SqlClient,
  ) {
    const rows = yield* sql<{ readonly noteCount: number; readonly lastIndexedAt: string | null }>`
      SELECT
        (SELECT count(*) FROM files) AS "noteCount",
        (SELECT value FROM meta WHERE key = 'last_indexed_at') AS "lastIndexedAt"
    `;
    return { noteCount: rows[0]?.noteCount ?? 0, lastIndexedAt: rows[0]?.lastIndexedAt ?? null };
  });

  /** The vault's open index, opened (and, when it cannot be used, replaced by an empty one) once. */
  const openIndex = Effect.fn("MajordomeNotesSearch.openIndex")(function* (vaultRoot: string) {
    const open = indexes.get(vaultRoot);
    if (open !== undefined) return open;
    yield* fileSystem
      .makeDirectory(indexDir, { recursive: true })
      .pipe(Effect.mapError((cause) => new NotesIndexError({ stage: "open", cause })));
    const file = indexFile(vaultRoot);
    const opened = yield* openFile(file).pipe(
      Effect.catch((error) =>
        Effect.logInfo("Majordome is rebuilding a notes search index it could not use.", {
          error,
        }).pipe(Effect.andThen(removeIndexFile(file)), Effect.andThen(openFile(file))),
      ),
    );
    const counts = yield* readStatus(opened.index.sql).pipe(
      Effect.mapError((cause) => new NotesIndexError({ stage: "open", cause })),
      Effect.onError(() => opened.index.close),
    );
    indexes.set(vaultRoot, opened.index);
    statuses.set(vaultRoot, { state: opened.fresh ? "building" : "ready", ...counts });
    return opened.index;
  });

  const discardIndex = Effect.fn("MajordomeNotesSearch.discardIndex")(function* (
    vaultRoot: string,
  ) {
    const open = indexes.get(vaultRoot);
    indexes.delete(vaultRoot);
    statuses.set(vaultRoot, BUILDING);
    if (open !== undefined) yield* open.close;
    yield* removeIndexFile(indexFile(vaultRoot));
  });

  const scanNotes = Effect.fn("MajordomeNotesSearch.scanNotes")(function* (vaultRoot: string) {
    const found: Array<{
      readonly path: string;
      readonly mtimeMs: number;
      readonly size: number;
    }> = [];
    // Per folder, inside the scan's span.
    const visit: (folder: string, depth: number) => Effect.Effect<void, NotesIndexError> =
      Effect.fnUntraced(function* (folder, depth) {
        const names = yield* fileSystem.readDirectory(path.join(vaultRoot, folder)).pipe(
          // Only the vault's own folder has to be readable; one that vanished mid-scan is skipped.
          Effect.catch((cause) =>
            folder === ""
              ? Effect.fail(new NotesIndexError({ stage: "scan", cause }))
              : Effect.succeed<ReadonlyArray<string>>([]),
          ),
        );
        const folders: Array<string> = [];
        yield* Effect.forEach(
          names,
          // Per directory entry, inside the scan's span.
          Effect.fnUntraced(function* (name) {
            if (isSkippedEntry(name)) return;
            const relative = folder === "" ? name : `${folder}/${name}`;
            const info = yield* fileSystem.stat(path.join(vaultRoot, relative)).pipe(Effect.option);
            if (Option.isNone(info)) return;
            if (info.value.type === "Directory") {
              if (depth < MAX_FOLDER_DEPTH) folders.push(relative);
            } else if (info.value.type === "File" && isNoteFile(name)) {
              const size = Number(info.value.size);
              if (size > NOTE_MAX_BYTES) return;
              found.push({
                path: relative,
                mtimeMs: Math.trunc(Option.getOrUndefined(info.value.mtime)?.getTime() ?? 0),
                size,
              });
            }
          }),
          { concurrency: STAT_CONCURRENCY, discard: true },
        );
        yield* Effect.forEach(folders, (next) => visit(next, depth + 1), { discard: true });
      });
    yield* visit("", 0);
    return found;
  });

  const runPass = Effect.fn("MajordomeNotesSearch.runPass")(function* (vaultRoot: string) {
    const { sql } = yield* openIndex(vaultRoot);
    const writeError = (cause: unknown) => new NotesIndexError({ stage: "write", cause });
    const known = new Map(
      (yield* sql`
        SELECT id, path, mtime_ms AS "mtimeMs", size, hash FROM files
      `.pipe(Effect.flatMap(decodeFileRows), Effect.mapError(writeError))).map(
        (row) => [row.path, row] as const,
      ),
    );
    const onDisk = yield* scanNotes(vaultRoot);
    const present = new Set(onDisk.map((file) => file.path));
    const removed = [...known.values()].filter((row) => !present.has(row.path));
    const changed = onDisk.filter((file) => {
      const row = known.get(file.path);
      return row === undefined || row.mtimeMs !== file.mtimeMs || row.size !== file.size;
    });
    let nextId = Math.max(0, ...[...known.values()].map((row) => row.id)) + 1;
    let indexed = 0;
    let removedCount = removed.length;

    const removeRows = (ids: ReadonlyArray<number>) =>
      ids.length === 0
        ? Effect.void
        : Effect.gen(function* () {
            yield* sql`DELETE FROM notes WHERE rowid IN ${sql.in(ids)}`;
            yield* sql`DELETE FROM files WHERE id IN ${sql.in(ids)}`;
          });

    for (let start = 0; start < removed.length; start += WRITE_BATCH) {
      yield* sql
        .withTransaction(removeRows(removed.slice(start, start + WRITE_BATCH).map((row) => row.id)))
        .pipe(Effect.mapError(writeError));
    }

    for (let start = 0; start < changed.length; start += WRITE_BATCH) {
      const batch = yield* Effect.forEach(
        changed.slice(start, start + WRITE_BATCH),
        // Per note, inside the pass's span.
        Effect.fnUntraced(function* (file) {
          const text = yield* fileSystem
            .readFileString(path.join(vaultRoot, file.path))
            .pipe(Effect.option);
          // Gone or unreadable since the scan: the next pass settles it.
          if (Option.isNone(text)) return { file, note: null, hash: "" };
          return {
            file,
            note: readNote(file.path, text.value),
            hash: NodeCrypto.createHash("sha1").update(text.value).digest("hex"),
          };
        }),
        { concurrency: READ_CONCURRENCY },
      );
      const touched: Array<{
        readonly id: number;
        readonly mtimeMs: number;
        readonly size: number;
      }> = [];
      const dropped: Array<number> = [];
      const replaced: Array<number> = [];
      const fileRows: Array<Record<string, string | number>> = [];
      const noteRows: Array<Record<string, string | number>> = [];
      for (const { file, note, hash } of batch) {
        const row = known.get(file.path);
        if (note === null) {
          if (row !== undefined) dropped.push(row.id);
          continue;
        }
        if (row !== undefined && row.hash === hash) {
          // Same words, new modified time, as after a git checkout.
          touched.push({ id: row.id, mtimeMs: file.mtimeMs, size: file.size });
          continue;
        }
        const id = row?.id ?? nextId++;
        if (row !== undefined) replaced.push(id);
        fileRows.push({
          id,
          path: file.path,
          mtime_ms: file.mtimeMs,
          size: file.size,
          hash,
          headings: note.headingsJson,
        });
        noteRows.push({
          rowid: id,
          path: file.path,
          title: note.title,
          headings: note.headings.map((heading) => heading.text).join("\n"),
          body: note.body,
        });
      }
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* removeRows([...dropped, ...replaced]);
            for (const row of touched) {
              yield* sql`
                UPDATE files SET mtime_ms = ${row.mtimeMs}, size = ${row.size} WHERE id = ${row.id}
              `;
            }
            if (Arr.isReadonlyArrayNonEmpty(fileRows) && Arr.isReadonlyArrayNonEmpty(noteRows)) {
              yield* sql`INSERT INTO files ${sql.insert(fileRows)}`;
              yield* sql`INSERT INTO notes ${sql.insert(noteRows)}`;
            }
          }),
        )
        .pipe(Effect.mapError(writeError));
      indexed += fileRows.length;
      removedCount += dropped.length;
    }

    const lastIndexedAt = isoTime(yield* Clock.currentTimeMillis);
    yield* sql`
      INSERT INTO meta (key, value) VALUES ('last_indexed_at', ${lastIndexedAt})
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `.pipe(Effect.mapError(writeError));
    const counts = yield* readStatus(sql).pipe(Effect.mapError(writeError));
    statuses.set(vaultRoot, { state: "ready", ...counts });
    return {
      scanned: onDisk.length,
      read: changed.length,
      indexed,
      removed: removedCount,
    } satisfies NotesIndexPass;
  });

  const isVault = (root: string) =>
    fileSystem.exists(path.join(root, ".majordome")).pipe(Effect.orElseSucceed(() => false));

  const markFailed = (vaultRoot: string, error: NotesIndexError) =>
    Effect.sync(() => {
      statuses.set(vaultRoot, {
        ...(statuses.get(vaultRoot) ?? BUILDING),
        state: "error",
        reason: STAGE_REASONS[error.stage],
      });
    });

  /** A pass, and after an index that failed mid-pass, one more on a new index. */
  const passOrRebuild = (vaultRoot: string) =>
    runPass(vaultRoot).pipe(
      Effect.catchIf(
        (error) => error.stage !== "scan",
        () => discardIndex(vaultRoot).pipe(Effect.andThen(runPass(vaultRoot))),
      ),
      Effect.tapError((error) => markFailed(vaultRoot, error)),
    );

  const refresh: MajordomeNotesSearch["Service"]["refresh"] = Effect.fn(
    "MajordomeNotesSearch.refresh",
  )(function* (vaultRoot) {
    if (!(yield* isVault(vaultRoot))) return null;
    const ticket = (requested.get(vaultRoot) ?? 0) + 1;
    requested.set(vaultRoot, ticket);
    return yield* passLock.withLock(
      vaultRoot,
      Effect.gen(function* () {
        // A pass that started after this call already saw what it is about.
        if ((covered.get(vaultRoot) ?? 0) >= ticket) return null;
        covered.set(vaultRoot, requested.get(vaultRoot) ?? ticket);
        return yield* passOrRebuild(vaultRoot).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Majordome could not update a notes search index.", {
              error,
            }).pipe(Effect.as(null)),
          ),
        );
      }),
    );
  });

  const refreshInBackground: MajordomeNotesSearch["Service"]["refreshInBackground"] = (vaultRoot) =>
    refresh(vaultRoot).pipe(Effect.forkIn(serviceScope), Effect.asVoid);

  const projectVault = Effect.fn("MajordomeNotesSearch.projectVault")(function* (
    projectId: ProjectId,
  ) {
    const project = Option.getOrUndefined(yield* projects.get(projectId));
    if (project === undefined) return undefined;
    return (yield* isVault(project.workspaceRoot)) ? project.workspaceRoot : undefined;
  });

  const threadVault = Effect.fn("MajordomeNotesSearch.threadVault")(function* (threadId: ThreadId) {
    const thread = yield* projections.getThreadShell(threadId);
    if (thread === null) return undefined;
    const root =
      thread.worktreePath ??
      Option.getOrUndefined(yield* projects.get(thread.projectId))?.workspaceRoot;
    return root !== undefined && (yield* isVault(root)) ? root : undefined;
  });

  /** The status as it is; a vault no pass has reached yet gets its first one in the background. */
  const statusOf = Effect.fn("MajordomeNotesSearch.statusOf")(function* (vaultRoot: string) {
    const known = statuses.get(vaultRoot);
    if (known !== undefined) return known;
    statuses.set(vaultRoot, BUILDING);
    yield* refreshInBackground(vaultRoot);
    return BUILDING;
  });

  const query = Effect.fn("MajordomeNotesSearch.query")(function* (input: {
    readonly vaultRoot: string;
    readonly query: string;
    readonly folder?: string | undefined;
    readonly limit?: number | undefined;
  }) {
    const match = notesMatchQuery(input.query);
    const sql = indexes.get(input.vaultRoot)?.sql;
    if (match === null || sql === undefined) return [];
    const folder = normalizeFolder(input.folder);
    const limit = input.limit ?? DEFAULT_RESULT_LIMIT;
    // The best notes are picked on rank alone, then only those have their text marked.
    const rows = yield* sql`
      WITH top AS MATERIALIZED (
        SELECT notes.rowid AS id, notes.rank AS score
        FROM notes
        WHERE notes MATCH ${match}
          ${
            folder === null
              ? sql``
              : sql`AND notes.rowid IN (
                  SELECT id FROM files WHERE path >= ${`${folder}/`} AND path < ${`${folder}0`}
                )`
          }
        ORDER BY notes.rank
        LIMIT ${limit}
      )
      SELECT
        files.path AS path,
        notes.title AS title,
        files.mtime_ms AS "mtimeMs",
        files.headings AS headings,
        instr(highlight(notes, 3, char(1), char(2)), char(1)) AS "matchAt",
        length(highlight(notes, 3, char(1), char(2))) AS "markedLength",
        substr(
          highlight(notes, 3, char(1), char(2)),
          max(1, instr(highlight(notes, 3, char(1), char(2)), char(1)) - ${SNIPPET_LEAD}),
          ${SNIPPET_WINDOW}
        ) AS window
      FROM notes
      INNER JOIN top ON top.id = notes.rowid
      INNER JOIN files ON files.id = notes.rowid
      WHERE notes MATCH ${match}
      ORDER BY top.score, files.mtime_ms DESC
    `.pipe(
      Effect.flatMap(decodeHitRows),
      Effect.mapError((cause) => new NotesIndexError({ stage: "query", cause })),
    );
    return rows.map((row): MajordomeNotesSearchHit => {
      const windowStart = Math.max(1, row.matchAt - SNIPPET_LEAD);
      return {
        path: row.path,
        title: row.title,
        heading: row.matchAt === 0 ? null : headingAt(row.headings, row.matchAt - 1),
        ...shapeSnippet(row.window, {
          before: windowStart > 1,
          after: windowStart + SNIPPET_WINDOW - 1 < row.markedLength,
        }),
        modifiedAt: isoTime(row.mtimeMs),
      };
    });
  });

  /** Results from the index; one that cannot be read answers with nothing and is rebuilt. */
  const searchVault = Effect.fn("MajordomeNotesSearch.searchVault")(function* (
    input: Parameters<typeof query>[0],
  ) {
    const results = yield* query(input).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Majordome could not read a notes search index.", { error }).pipe(
          Effect.andThen(
            passLock
              .withLock(
                input.vaultRoot,
                discardIndex(input.vaultRoot).pipe(Effect.andThen(passOrRebuild(input.vaultRoot))),
              )
              .pipe(Effect.ignore, Effect.forkIn(serviceScope)),
          ),
          Effect.as<ReadonlyArray<MajordomeNotesSearchHit>>([]),
        ),
      ),
    );
    return { results, status: yield* statusOf(input.vaultRoot) };
  });

  const NOT_A_VAULT = { results: [], status: null } satisfies MajordomeNotesSearchResult;

  const search: MajordomeNotesSearch["Service"]["search"] = Effect.fn(
    "MajordomeNotesSearch.search",
  )(
    function* (input) {
      const vaultRoot = yield* projectVault(input.projectId);
      if (vaultRoot === undefined) return NOT_A_VAULT;
      return yield* searchVault({ ...input, vaultRoot });
    },
    Effect.mapError((cause) => new MajordomeNotesSearchError({ operation: "search", cause })),
  );

  const searchForThread: MajordomeNotesSearch["Service"]["searchForThread"] = Effect.fn(
    "MajordomeNotesSearch.searchForThread",
  )(
    function* (input) {
      const vaultRoot = yield* threadVault(input.threadId);
      if (vaultRoot === undefined) return NOT_A_VAULT;
      yield* refresh(vaultRoot);
      return yield* searchVault({ ...input, vaultRoot });
    },
    Effect.mapError((cause) => new MajordomeNotesSearchError({ operation: "search", cause })),
  );

  const status: MajordomeNotesSearch["Service"]["status"] = Effect.fn(
    "MajordomeNotesSearch.status",
  )(
    function* (input) {
      const vaultRoot = yield* projectVault(input.projectId);
      return { status: vaultRoot === undefined ? null : yield* statusOf(vaultRoot) };
    },
    Effect.mapError((cause) => new MajordomeNotesSearchError({ operation: "status", cause })),
  );

  const rebuild: MajordomeNotesSearch["Service"]["rebuild"] = Effect.fn(
    "MajordomeNotesSearch.rebuild",
  )(
    function* (input) {
      const vaultRoot = yield* projectVault(input.projectId);
      if (vaultRoot === undefined) return { status: null };
      yield* passLock.withLock(
        vaultRoot,
        discardIndex(vaultRoot).pipe(Effect.andThen(passOrRebuild(vaultRoot))),
      );
      return { status: statuses.get(vaultRoot) ?? BUILDING };
    },
    Effect.mapError((cause) => new MajordomeNotesSearchError({ operation: "rebuild", cause })),
  );

  const refreshAll = Effect.gen(function* () {
    for (const project of yield* projects.list()) yield* refresh(project.workspaceRoot);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Majordome could not update the notes search.", { cause }),
    ),
  );

  const start: MajordomeNotesSearch["Service"]["start"] = Effect.fn("MajordomeNotesSearch.start")(
    function* () {
      yield* forkParked(refreshAll.pipe(Effect.repeat(Schedule.spaced(RECONCILE_INTERVAL))));
    },
  );

  return MajordomeNotesSearch.of({
    search,
    searchForThread,
    status,
    rebuild,
    refresh,
    refreshInBackground,
    start,
  });
});

export const layer = Layer.effect(MajordomeNotesSearch, make);
