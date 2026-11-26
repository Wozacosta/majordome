import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { type MajordomeLibraryFile, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as MajordomeLibrary from "./MajordomeLibrary.ts";

const vaultProject = ProjectId.make("vault-project");
const codeProject = ProjectId.make("code-project");

const IMAGE_ID = "thread-money-11111111-1111-4111-8111-111111111111";
const FILE_ID = "thread-money-22222222-2222-4222-8222-222222222222-csv";
const GONE_ID = "thread-money-33333333-3333-4333-8333-333333333333-pdf";
const PASTE_ID = "thread-money-44444444-4444-4444-8444-444444444444-txt";
const DELETED_ID = "thread-deleted-55555555-5555-4555-8555-555555555555-pdf";
const OTHER_ID = "thread-code-66666666-6666-4666-8666-666666666666-pdf";

const image = (id: string, name: string) => ({
  type: "image",
  id,
  name,
  mimeType: "image/png",
  sizeBytes: 3,
});
const file = (id: string, name: string, extra: object = {}) => ({
  type: "file",
  id,
  name,
  mimeType: "application/octet-stream",
  sizeBytes: 4,
  ...extra,
});

const setUp = Effect.fn("test.setUp")(function* (files: Readonly<Record<string, string>>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  const vault = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-library-vault-" });
  const code = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-library-code-" });
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  yield* fs.makeDirectory(attachmentsDir, { recursive: true });
  const write = (relativePath: string, text: string) =>
    fs
      .makeDirectory(path.dirname(path.join(vault, relativePath)), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(path.join(vault, relativePath), text)));
  yield* write(".majordome/config.json", "{}");
  for (const [relativePath, text] of Object.entries(files)) yield* write(relativePath, text);

  const thread = (threadId: string, projectId: string, title: string, deletedAt: string | null) =>
    sql`
      INSERT INTO orchestration_v2_projection_threads (
        thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
        created_at, updated_at, deleted_at, payload_json
      ) VALUES (
        ${threadId}, ${projectId}, ${title}, 'codex', 'full-access', 'default',
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', ${deletedAt}, '{}'
      )
    `;
  const message = (
    messageId: string,
    threadId: string,
    role: string,
    at: string,
    attachments: ReadonlyArray<object>,
  ) =>
    sql`
      INSERT INTO orchestration_v2_projection_messages (
        message_id, thread_id, role, streaming, created_at, updated_at, payload_json
      ) VALUES (
        ${messageId}, ${threadId}, ${role}, 0, ${at}, ${at}, ${JSON.stringify({ attachments })}
      )
    `;
  const stored = (name: string) => fs.writeFileString(path.join(attachmentsDir, name), "x");

  const roots: Record<string, string> = { [vaultProject]: vault, [codeProject]: code };
  const service = yield* Effect.service(MajordomeLibrary.MajordomeLibrary).pipe(
    Effect.provide(
      MajordomeLibrary.layer.pipe(
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: (projectId) =>
              Effect.succeed(
                roots[projectId] === undefined
                  ? Option.none()
                  : Option.some({ workspaceRoot: roots[projectId] } as ProjectStore.ProjectRow),
              ),
          }),
        ),
      ),
    ),
  );
  return { service, vault, fs, path, thread, message, stored };
});

const testLayer = ServerConfig.layerTest(process.cwd(), { prefix: "majordome-library-" }).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(testLayer)("MajordomeLibrary", (it) => {
  it.effect(
    "lists the notes folder's files and the chats' attachments together, newest first",
    () =>
      Effect.gen(function* () {
        const { service, vault, fs, path, thread, message, stored } = yield* setUp({
          "log.md": "# A note is not a file\n",
          "admin/finances/bill.pdf": "%PDF",
          "inbox/scan.png": "png",
          ".agents/held-back/secret.txt": "hidden",
        });
        yield* fs.utimes(path.join(vault, "admin/finances/bill.pdf"), 1_000, 1_000);
        yield* fs.utimes(path.join(vault, "inbox/scan.png"), 2_000, 2_000);

        yield* thread("thread-money", vaultProject, "Money", null);
        yield* thread("thread-fork", vaultProject, "Money, again", null);
        yield* thread("thread-deleted", vaultProject, "Gone", "2026-10-02T00:00:00.000Z");
        yield* thread("thread-code", codeProject, "Code", null);
        yield* message("m1", "thread-money", "user", "2026-10-03T10:00:00.000Z", [
          image(IMAGE_ID, "receipt.png"),
          file(FILE_ID, "prices.csv"),
          file(GONE_ID, "deleted-since.pdf"),
          file(PASTE_ID, "pasted.txt", { source: { _tag: "pasted-text" } }),
        ]);
        // A branch repeats its source's messages: the file stays with the chat it was sent in.
        yield* message("m1-fork", "thread-fork", "user", "2026-10-04T10:00:00.000Z", [
          image(IMAGE_ID, "receipt.png"),
        ]);
        yield* message("m2", "thread-deleted", "user", "2026-10-05T10:00:00.000Z", [
          file(DELETED_ID, "old.pdf"),
        ]);
        yield* message("m3", "thread-code", "user", "2026-10-05T10:00:00.000Z", [
          file(OTHER_ID, "other.pdf"),
        ]);
        yield* stored(`${IMAGE_ID}.png`);
        yield* stored(`${FILE_ID}.csv`);
        yield* stored(`${PASTE_ID}.txt`);
        yield* stored(`${DELETED_ID}.pdf`);
        yield* stored(`${OTHER_ID}.pdf`);

        const chat = { threadId: ThreadId.make("thread-money"), threadTitle: "Money" };
        const chats: ReadonlyArray<MajordomeLibraryFile> = [
          {
            _tag: "chat-file",
            attachmentId: FILE_ID,
            name: "prices.csv",
            mimeType: "application/octet-stream",
            sizeBytes: 4,
            at: "2026-10-03T10:00:00.000Z",
            ...chat,
          },
          {
            _tag: "chat-file",
            attachmentId: IMAGE_ID,
            name: "receipt.png",
            mimeType: "image/png",
            sizeBytes: 3,
            at: "2026-10-03T10:00:00.000Z",
            ...chat,
          },
        ];
        assert.deepEqual(yield* service.list({ projectId: vaultProject }), {
          files: [
            ...chats,
            {
              _tag: "notes-file",
              path: "inbox/scan.png",
              name: "scan.png",
              sizeBytes: 3,
              at: "1970-01-01T00:33:20.000Z",
            },
            {
              _tag: "notes-file",
              path: "admin/finances/bill.pdf",
              name: "bill.pdf",
              sizeBytes: 4,
              at: "1970-01-01T00:16:40.000Z",
            },
          ],
          total: 4,
        });
        assert.deepEqual(yield* service.list({ projectId: vaultProject, chatsOnly: true }), {
          files: chats,
          total: 2,
        });
      }),
  );

  it.effect("has nothing for a project that is not a notes folder", () =>
    Effect.gen(function* () {
      const { service } = yield* setUp({});
      assert.deepEqual(yield* service.list({ projectId: codeProject }), { files: [], total: 0 });
      assert.deepEqual(yield* service.list({ projectId: ProjectId.make("nowhere") }), {
        files: [],
        total: 0,
      });
    }),
  );
});
