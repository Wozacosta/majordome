import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { type MajordomeNotesSearchHit, ProjectId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as MajordomeNotesSearch from "./MajordomeNotesSearch.ts";
import { NOTE_MAX_BYTES } from "./notesIndex.ts";

const layerTest = (prefix: string) =>
  ServerConfig.layerTest(process.cwd(), { prefix }).pipe(Layer.provideMerge(NodeServices.layer));

const vaultProject = ProjectId.make("vault-project");
const codeProject = ProjectId.make("code-project");
const vaultThread = ThreadId.make("thread:vault");

const projectRow = (projectId: ProjectId, workspaceRoot: string): ProjectStore.ProjectRow => ({
  projectId,
  title: "Notes",
  hasCustomTitle: false,
  workspaceRoot,
  trackedFolders: [],
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  pinnedAt: null,
  archivedAt: null,
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
  deletedAt: null,
});

const makeFolder = Effect.fn("test.makeFolder")(function* (
  files: Readonly<Record<string, string>>,
  options: { readonly vault: boolean } = { vault: true },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-notes-search-" });
  const write = (relativePath: string, text: string) =>
    fs
      .makeDirectory(path.dirname(path.join(root, relativePath)), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(path.join(root, relativePath), text)));
  if (options.vault) yield* write(".majordome/config.json", "{}");
  for (const [relativePath, text] of Object.entries(files)) yield* write(relativePath, text);
  return { root, write, fs, path };
});

/** The service over these projects; it closes, with its index files, when the scope does. */
const makeService = (roots: Readonly<Record<string, string>>) =>
  Layer.build(
    MajordomeNotesSearch.layer.pipe(
      Layer.provide(
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: (projectId) =>
            Effect.succeed(
              Option.fromNullishOr(roots[projectId]).pipe(
                Option.map((workspaceRoot) => projectRow(projectId, workspaceRoot)),
              ),
            ),
          list: () =>
            Effect.succeed(
              Object.entries(roots).map(([projectId, root]) =>
                projectRow(ProjectId.make(projectId), root),
              ),
            ),
        }),
      ),
      Layer.provide(
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadShell: (threadId) =>
            Effect.succeed(
              threadId === vaultThread
                ? ({ projectId: vaultProject, worktreePath: null } as never)
                : null,
            ),
        }),
      ),
    ),
  ).pipe(Effect.map((context) => Context.get(context, MajordomeNotesSearch.MajordomeNotesSearch)));

const NOTES = {
  "projects/taxes.md":
    "# Impôts 2026\n\nDéclaration à envoyer avant l'été.\n\n## Pièces\n\nFacture URSSAF et relevé bancaire.\n",
  "daily/2026-11-01.md":
    "Called the accountant.\n\nShe wants the declaration early, and says the impôts are lower this year.\n",
  "inbox/garden.txt": "Tomatoes, basil, and a note to buy soil.\n",
};

const paths = (results: ReadonlyArray<MajordomeNotesSearchHit>) =>
  results.map((result) => result.path);
const marked = (result: MajordomeNotesSearchHit | undefined) =>
  result?.highlights.map(({ start, end }) => result.snippet.slice(start, end));

/** The vault's index file, which is the only one this server has. */
const indexFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join((yield* ServerConfig.ServerConfig).stateDir, "notes-search");
  const files = (yield* fs.readDirectory(directory)).filter((name) => name.endsWith(".sqlite"));
  assert.lengthOf(files, 1);
  return path.join(directory, files[0]!);
});

it.layer(layerTest("majordome-notes-search-"))("MajordomeNotesSearch", (it) => {
  it.effect("finds notes by their words, whatever the accents, prefixes and phrases", () =>
    Effect.gen(function* () {
      const vault = yield* makeFolder({
        ...NOTES,
        ".obsidian/workspace.md": "impôts",
        ".majordome/notes.md": "impôts",
        ".git/description.md": "impôts",
        "node_modules/pkg/readme.md": "impôts",
        "attachments/scan.png": "impôts",
        "archive/export.md": `impôts ${"x".repeat(NOTE_MAX_BYTES)}`,
        "archive/binary.md": "impôts \u0000\u0001",
      });
      const code = yield* makeFolder({ "readme.md": "impôts" }, { vault: false });
      const service = yield* makeService({ [vaultProject]: vault.root, [codeProject]: code.root });
      const search = (query: string, folder?: string) =>
        service
          .search({ projectId: vaultProject, query, folder })
          .pipe(Effect.map((result) => result.results));

      assert.deepStrictEqual(yield* service.status({ projectId: vaultProject }), {
        status: { state: "building", noteCount: 0, lastIndexedAt: null },
      });
      // The oversized export is never read; the binary one is read and left out.
      assert.deepStrictEqual(yield* service.refresh(vault.root), {
        scanned: 4,
        read: 4,
        indexed: 3,
        removed: 0,
      });
      const { status } = yield* service.status({ projectId: vaultProject });
      assert.strictEqual(status?.state, "ready");
      assert.strictEqual(status?.noteCount, 3);
      assert.isNotNull(status?.lastIndexedAt);

      // A word in the title outranks the same word in another note's text.
      const taxes = yield* search("impots");
      assert.deepStrictEqual(paths(taxes), ["projects/taxes.md", "daily/2026-11-01.md"]);
      assert.strictEqual(taxes[0]?.title, "Impôts 2026");
      assert.strictEqual(taxes[1]?.title, "2026-11-01");
      assert.deepStrictEqual(marked(taxes[0]), ["Impôts"]);
      assert.deepStrictEqual(marked(taxes[1]), ["impôts"]);
      assert.include(taxes[1]?.snippet, "says the impôts are lower");

      const urssaf = yield* search("URSSAF");
      assert.strictEqual(urssaf[0]?.heading, "Pièces");
      assert.deepStrictEqual(marked(urssaf[0]), ["URSSAF"]);
      assert.strictEqual(urssaf[0]?.snippet.includes("#"), false);

      assert.deepStrictEqual(paths(yield* search("DECL")).toSorted(), [
        "daily/2026-11-01.md",
        "projects/taxes.md",
      ]);
      assert.deepStrictEqual(paths(yield* search("declaration ete")), ["projects/taxes.md"]);
      assert.deepStrictEqual(paths(yield* search('"avant l\'ete"')), ["projects/taxes.md"]);
      assert.deepStrictEqual(paths(yield* search('"ete avant"')), []);
      assert.deepStrictEqual(paths(yield* search("impots", "daily/")), ["daily/2026-11-01.md"]);
      // A note is found by its folder and file name too.
      assert.deepStrictEqual(paths(yield* search("garden")), ["inbox/garden.txt"]);

      for (const query of ["", "   ", '"', '""', "(", "*", "-", "impots AND", "NEAR(", "a:b ^c"]) {
        assert.isArray(yield* search(query), query);
      }
      assert.deepStrictEqual(paths(yield* search("impots NOT")), []);

      assert.deepStrictEqual(yield* service.search({ projectId: codeProject, query: "impots" }), {
        results: [],
        status: null,
      });
      assert.isNull(yield* service.refresh(code.root));
    }),
  );

  it.effect("reads only what changed: an edit, a rename, a removal, a new note", () =>
    Effect.gen(function* () {
      const vault = yield* makeFolder(NOTES);
      const service = yield* makeService({ [vaultProject]: vault.root });
      const search = (query: string) =>
        service
          .search({ projectId: vaultProject, query })
          .pipe(Effect.map((result) => paths(result.results)));
      yield* service.refresh(vault.root);

      assert.deepStrictEqual(yield* service.refresh(vault.root), {
        scanned: 3,
        read: 0,
        indexed: 0,
        removed: 0,
      });

      yield* vault.write("inbox/garden.txt", "Tomatoes, basil, and courgettes this year.\n");
      yield* vault.fs.rename(
        vault.path.join(vault.root, "projects/taxes.md"),
        vault.path.join(vault.root, "projects/impots-2026.md"),
      );
      yield* vault.fs.remove(vault.path.join(vault.root, "daily/2026-11-01.md"));
      yield* vault.write("projects/house.md", "# House\n\nQuote for the roof.\n");
      assert.deepStrictEqual(yield* service.refresh(vault.root), {
        scanned: 3,
        read: 3,
        indexed: 3,
        removed: 2,
      });
      assert.deepStrictEqual(yield* search("courgettes"), ["inbox/garden.txt"]);
      assert.deepStrictEqual(yield* search("soil"), []);
      assert.deepStrictEqual(yield* search("urssaf"), ["projects/impots-2026.md"]);
      assert.deepStrictEqual(yield* search("accountant"), []);
      assert.deepStrictEqual(yield* search("roof"), ["projects/house.md"]);

      // The same words under a new modified time, as after a checkout, are read and not indexed.
      yield* vault.fs.utimes(vault.path.join(vault.root, "projects/house.md"), 1_000, 1_000);
      assert.deepStrictEqual(yield* service.refresh(vault.root), {
        scanned: 3,
        read: 1,
        indexed: 0,
        removed: 0,
      });
      assert.deepStrictEqual(yield* search("roof"), ["projects/house.md"]);
    }),
  );

  it.effect("an agent's search sees what was written a moment ago", () =>
    Effect.gen(function* () {
      const vault = yield* makeFolder(NOTES);
      const service = yield* makeService({ [vaultProject]: vault.root });
      const found = yield* service.searchForThread({ threadId: vaultThread, query: "tomat" });
      assert.deepStrictEqual(paths(found.results), ["inbox/garden.txt"]);
      assert.strictEqual(found.status?.state, "ready");

      yield* vault.write("inbox/call.md", "Call the plumber about the tomato-red tap.\n");
      assert.deepStrictEqual(
        paths(
          (yield* service.searchForThread({ threadId: vaultThread, query: "plumber" })).results,
        ),
        ["inbox/call.md"],
      );
      assert.deepStrictEqual(
        yield* service.searchForThread({ threadId: ThreadId.make("thread:other"), query: "x" }),
        { results: [], status: null },
      );
    }),
  );
});

// Each of these breaks the server's one index file, so each has its own state directory.
const rebuilds = (
  name: string,
  damage: (file: string) => Effect.Effect<void, PlatformError | SqlError, FileSystem.FileSystem>,
) =>
  it.effect(`builds the index again when it ${name}`, () =>
    Effect.gen(function* () {
      const vault = yield* makeFolder(NOTES);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* makeService({ [vaultProject]: vault.root });
          yield* service.refresh(vault.root);
        }),
      );
      const file = yield* indexFile;
      yield* damage(file);

      const service = yield* makeService({ [vaultProject]: vault.root });
      assert.deepStrictEqual(yield* service.refresh(vault.root), {
        scanned: 3,
        read: 3,
        indexed: 3,
        removed: 0,
      });
      const { results, status } = yield* service.search({ projectId: vaultProject, query: "soil" });
      assert.deepStrictEqual(paths(results), ["inbox/garden.txt"]);
      assert.strictEqual(status?.state, "ready");
    }).pipe(
      // The index must close before the state folder provided below is removed.
      Effect.scoped,
      Effect.provide(layerTest("majordome-notes-search-rebuild-")),
    ),
  );

rebuilds("is missing", (file) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(file, { force: true })),
);
rebuilds("is damaged", (file) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.forEach([`${file}-wal`, `${file}-shm`], (extra) => fs.remove(extra, { force: true }), {
      discard: true,
    }).pipe(Effect.andThen(fs.writeFileString(file, "not a database ".repeat(400)))),
  ),
);
rebuilds("was made by another version", (file) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(`PRAGMA user_version = ${MajordomeNotesSearch.NOTES_INDEX_VERSION + 1}`);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: file }))),
);

it.effect("rebuilds on request, and says so when the index cannot be opened", () =>
  Effect.gen(function* () {
    // Closed before its files are removed below: an open index still writes beside them.
    yield* Effect.scoped(
      Effect.gen(function* () {
        const vault = yield* makeFolder(NOTES);
        const service = yield* makeService({ [vaultProject]: vault.root });
        yield* service.refresh(vault.root);
        yield* vault.write("inbox/new.md", "A fresh idea.\n");
        const rebuilt = yield* service.rebuild({ projectId: vaultProject });
        assert.strictEqual(rebuilt.status?.state, "ready");
        assert.strictEqual(rebuilt.status?.noteCount, 4);
        assert.deepStrictEqual(yield* service.rebuild({ projectId: codeProject }), {
          status: null,
        });
      }),
    );

    // Nothing can be written where the index files live.
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.join((yield* ServerConfig.ServerConfig).stateDir, "notes-search");
    yield* Effect.scoped(
      Effect.gen(function* () {
        const other = yield* makeFolder(NOTES);
        const broken = yield* makeService({ [vaultProject]: other.root });
        yield* fs.remove(directory, { recursive: true });
        yield* fs.writeFileString(directory, "in the way");
        assert.isNull(yield* broken.refresh(other.root));
        const { results, status } = yield* broken.search({
          projectId: vaultProject,
          query: "soil",
        });
        assert.deepStrictEqual(results, []);
        assert.deepStrictEqual(status, {
          state: "error",
          noteCount: 0,
          lastIndexedAt: null,
          reason: "The search index could not be opened.",
        });
      }),
    );
  }).pipe(Effect.scoped, Effect.provide(layerTest("majordome-notes-search-status-"))),
);
