import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { MAJORDOME_TOPIC_FILE_MAX_BYTES, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { TestClock } from "effect/testing";

import * as AssetSigner from "../assets/AssetSigner.ts";
import { createPendingAttachmentId, createAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as MajordomeTopicFiles from "./MajordomeTopicFiles.ts";
import * as VaultLock from "./VaultLock.ts";

const vaultProject = ProjectId.make("vault-project");
const codeProject = ProjectId.make("code-project");

const TOPICS = JSON.stringify({
  topics: [
    { id: "finances", title: "Finances", folder: "admin/finances" },
    { id: "travel", title: "Travel", folder: "projects/travel" },
  ],
});

const setUp = Effect.fn("test.setUp")(function* (
  files: Readonly<Record<string, string>>,
  options: { readonly countObjects?: string | null } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vault = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-files-vault-" });
  const code = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-files-code-" });
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  yield* fs.makeDirectory(attachmentsDir, { recursive: true });
  const write = (relativePath: string, text: string) =>
    fs
      .makeDirectory(path.dirname(path.join(vault, relativePath)), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(path.join(vault, relativePath), text)));
  yield* write(".majordome/config.json", "{}");
  yield* write(".majordome/topics.json", TOPICS);
  for (const [relativePath, text] of Object.entries(files)) yield* write(relativePath, text);
  const roots: Record<string, string> = { [vaultProject]: vault, [codeProject]: code };
  const service = yield* Effect.service(MajordomeTopicFiles.MajordomeTopicFiles).pipe(
    Effect.provide(
      MajordomeTopicFiles.layer.pipe(
        Layer.provide(VaultLock.layer),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProjectStore.ProjectStoreV2)({
              get: (projectId) =>
                Effect.succeed(
                  roots[projectId] === undefined
                    ? Option.none()
                    : Option.some({ workspaceRoot: roots[projectId] } as ProjectStore.ProjectRow),
                ),
            }),
            Layer.mock(AssetSigner.AssetSigner)({
              sign: (payload) => Effect.succeed(`signed-${payload.length}`),
              verify: (payload, signature) =>
                Effect.succeed(signature === `signed-${payload.length}`),
            }),
            Layer.mock(ProcessRunner.ProcessRunner)({
              run: () =>
                options.countObjects == null
                  ? Effect.die("git is not there")
                  : Effect.succeed({
                      code: 0,
                      stdout: options.countObjects,
                    } as ProcessRunner.ProcessRunOutput),
            }),
          ),
        ),
      ),
    ),
  );
  /** A pending upload, as `attachments.createUploadUrl` and its POST leave one. */
  const upload = Effect.fn("test.upload")(function* (bytes: Uint8Array | string) {
    const attachmentId = createPendingAttachmentId(".pdf");
    const file = path.join(attachmentsDir, `${attachmentId}.pdf`);
    yield* typeof bytes === "string" ? fs.writeFileString(file, bytes) : fs.writeFile(file, bytes);
    return { attachmentId, file };
  });
  const exists = (relativePath: string) => fs.exists(path.join(vault, relativePath));
  const read = (relativePath: string) => fs.readFileString(path.join(vault, relativePath));
  return { service, vault, fs, path, upload, exists, read };
});

const errorMessage = <A, E extends { readonly message: string }>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit)
    ? Option.match(Exit.findErrorOption(exit), { onNone: () => "", onSome: (e) => e.message })
    : "";

const NOT_A_TOPIC_FILE = "That file is not one of a topic's files.";

const baseLayer = ServerConfig.layerTest(process.cwd(), { prefix: "majordome-topic-files-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);

it.layer(baseLayer)("MajordomeTopicFiles", (it) => {
  it.effect("lists what is not Markdown in the topic's folder, newest first", () =>
    Effect.gen(function* () {
      const { service, vault, fs, path } = yield* setUp({
        "admin/finances/log.md": "# Finances\n",
        "admin/finances/passport.MD": "# Passport\n",
        "admin/finances/electricity_bill.pdf": "%PDF-1.4",
        "admin/finances/2026/lease scan.png": "png",
        "admin/finances/notes.txt": "plain text",
        "admin/finances/.DS_Store": "hidden",
        "admin/finances/.cache/thumb.png": "hidden folder",
        "admin/taxes/return.pdf": "another folder",
        "projects/travel/ticket.pdf": "another topic",
      });
      yield* fs.utimes(path.join(vault, "admin/finances/electricity_bill.pdf"), 1_000, 1_000);
      yield* fs.utimes(path.join(vault, "admin/finances/notes.txt"), 2_000, 2_000);
      yield* fs.utimes(path.join(vault, "admin/finances/2026/lease scan.png"), 3_000, 3_000);

      assert.deepEqual(yield* service.list({ projectId: vaultProject, topicId: "finances" }), {
        files: [
          {
            path: "admin/finances/2026/lease scan.png",
            name: "lease scan.png",
            sizeBytes: 3,
            modifiedAt: "1970-01-01T00:50:00.000Z",
          },
          {
            path: "admin/finances/notes.txt",
            name: "notes.txt",
            sizeBytes: 10,
            modifiedAt: "1970-01-01T00:33:20.000Z",
          },
          {
            path: "admin/finances/electricity_bill.pdf",
            name: "electricity_bill.pdf",
            sizeBytes: 8,
            modifiedAt: "1970-01-01T00:16:40.000Z",
          },
        ],
        total: 3,
        large: false,
      });
    }),
  );

  it.effect(
    "is empty for an unknown topic, a missing folder and a project that is not a vault",
    () =>
      Effect.gen(function* () {
        const { service } = yield* setUp({});
        const empty = { files: [], total: 0, large: false };
        assert.deepEqual(yield* service.list({ projectId: vaultProject, topicId: "gone" }), empty);
        assert.deepEqual(
          yield* service.list({ projectId: vaultProject, topicId: "travel" }),
          empty,
        );
        assert.deepEqual(
          yield* service.list({ projectId: codeProject, topicId: "finances" }),
          empty,
        );
      }),
  );

  it.effect("caps the list and still counts every file", () =>
    Effect.gen(function* () {
      const { service } = yield* setUp(
        Object.fromEntries(
          Array.from({ length: 103 }, (_, index) => [`admin/finances/scan-${index}.pdf`, "x"]),
        ),
      );
      const result = yield* service.list({ projectId: vaultProject, topicId: "finances" });
      assert.equal(result.files.length, 100);
      assert.equal(result.total, 103);
    }),
  );

  it.effect("calls the notes folder large once its saved history passes 1 GB", () =>
    Effect.gen(function* () {
      const under = yield* setUp(
        {},
        { countObjects: "count: 3\nsize: 24\nin-pack: 90\nsize-pack: 1048000\n" },
      );
      const input = { projectId: vaultProject, topicId: "finances" };
      assert.isFalse((yield* under.service.list(input)).large);
      const over = yield* setUp(
        {},
        { countObjects: "count: 3\nsize: 600\nin-pack: 90\nsize-pack: 1048000\n" },
      );
      assert.isTrue((yield* over.service.list(input)).large);
      const unreadable = yield* setUp({ "admin/finances/a.pdf": "x" }, { countObjects: "fatal" });
      assert.deepEqual(
        yield* unreadable.service
          .list(input)
          .pipe(Effect.map((result) => [result.total, result.large])),
        [1, false],
      );
    }),
  );

  it.effect("adds an upload under a name that replaces nothing, and deletes the upload", () =>
    Effect.gen(function* () {
      const { service, upload, read, exists, fs } = yield* setUp({
        "admin/finances/Bill.pdf": "the first",
        "admin/finances/bill 2.pdf": "the second",
      });
      const first = yield* upload("the third");
      const added = yield* service.add({
        projectId: vaultProject,
        topicId: "finances",
        attachmentId: first.attachmentId,
        fileName: "../../bill.pdf",
      });
      assert.equal(added.path, "admin/finances/bill 3.pdf");
      assert.equal(added.sizeBytes, 9);
      assert.equal(yield* read("admin/finances/bill 3.pdf"), "the third");
      assert.equal(yield* read("admin/finances/Bill.pdf"), "the first");
      assert.isFalse(yield* fs.exists(first.file));

      // The topic's folder is created when it is missing, and a dot name cannot hide the file.
      const second = yield* upload("ticket");
      const inNewFolder = yield* service.add({
        projectId: vaultProject,
        topicId: "travel",
        attachmentId: second.attachmentId,
        fileName: ".ticket",
      });
      assert.equal(inNewFolder.path, "projects/travel/ticket");
      assert.isTrue(yield* exists("projects/travel/ticket"));
    }),
  );

  it.effect(
    "refuses a file over the limit, an unknown topic and an upload that is not pending",
    () =>
      Effect.gen(function* () {
        const { service, upload, exists, fs } = yield* setUp({
          "admin/finances/log.md": "# Log\n",
        });
        const big = yield* upload(new Uint8Array(MAJORDOME_TOPIC_FILE_MAX_BYTES + 1));
        const tooLarge = yield* service
          .add({
            projectId: vaultProject,
            topicId: "finances",
            attachmentId: big.attachmentId,
            fileName: "film.mov",
          })
          .pipe(Effect.exit);
        assert.equal(errorMessage(tooLarge), "That file is too large. Files can be up to 25 MB.");
        assert.isFalse(yield* exists("admin/finances/film.mov"));
        assert.isFalse(yield* fs.exists(big.file));

        const small = yield* upload("x");
        const unknownTopic = yield* service
          .add({
            projectId: vaultProject,
            topicId: "gone",
            attachmentId: small.attachmentId,
            fileName: "a.pdf",
          })
          .pipe(Effect.exit);
        assert.equal(errorMessage(unknownTopic), "That topic is no longer here.");

        const notPending = yield* service
          .add({
            projectId: vaultProject,
            topicId: "finances",
            attachmentId: createAttachmentId("thread-1") ?? "",
            fileName: "a.pdf",
          })
          .pipe(Effect.exit);
        assert.equal(errorMessage(notPending), "The upload did not arrive. Try adding it again.");
      }),
  );

  it.effect("removes a listed file and nothing else", () =>
    Effect.gen(function* () {
      const { service, vault, fs, path, exists } = yield* setUp({
        "admin/finances/bill.pdf": "bill",
        "admin/finances/log.md": "# Log\n",
        "admin/finances/.hidden/key.pem": "hidden",
        "admin/taxes/return.pdf": "not a topic's folder",
        "memory.md": "- Likes tea\n",
      });
      const outside = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-files-outside-" });
      yield* fs.writeFileString(path.join(outside, "secret.pdf"), "outside");
      yield* fs.symlink(outside, path.join(vault, "admin/finances/linked"));

      for (const refused of [
        "admin/finances/log.md",
        "admin/finances/.hidden/key.pem",
        "admin/taxes/return.pdf",
        "admin/finances/../taxes/return.pdf",
        "admin/finances/../../.majordome/topics.json",
        "../outside.pdf",
        path.join(vault, "admin/finances/bill.pdf"),
        "admin/finances/linked/secret.pdf",
        "admin/finances",
      ]) {
        const exit = yield* service
          .remove({ projectId: vaultProject, path: refused })
          .pipe(Effect.exit);
        assert.equal(errorMessage(exit), NOT_A_TOPIC_FILE, refused);
      }
      assert.isTrue(yield* exists("admin/finances/log.md"));
      assert.isTrue(yield* exists("admin/taxes/return.pdf"));
      assert.isTrue(yield* fs.exists(path.join(outside, "secret.pdf")));

      yield* service.remove({ projectId: vaultProject, path: "admin/finances/bill.pdf" });
      assert.isFalse(yield* exists("admin/finances/bill.pdf"));
      const again = yield* service
        .remove({ projectId: vaultProject, path: "admin/finances/bill.pdf" })
        .pipe(Effect.exit);
      assert.equal(errorMessage(again), "That file is no longer there.");
    }),
  );

  it.effect("serves a file only through a fresh link it signed, with the same path checks", () =>
    Effect.gen(function* () {
      const { service, vault, path } = yield* setUp({
        "admin/finances/bill.pdf": "bill",
        "admin/finances/log.md": "# Log\n",
      });
      const refused = yield* service
        .viewUrl({ projectId: vaultProject, path: "admin/finances/log.md" })
        .pipe(Effect.exit);
      assert.equal(errorMessage(refused), NOT_A_TOPIC_FILE);

      const { relativeUrl } = yield* service.viewUrl({
        projectId: vaultProject,
        path: "admin/finances/bill.pdf",
      });
      const prefix = `${MajordomeTopicFiles.TOPIC_FILE_VIEW_ROUTE_PREFIX}/`;
      assert.isTrue(relativeUrl.startsWith(prefix));
      const token = relativeUrl.slice(prefix.length);
      assert.deepEqual(Option.getOrNull(yield* service.readForOwner(token)), {
        path: path.join(vault, "admin/finances/bill.pdf"),
        fileName: "bill.pdf",
      });
      assert.isTrue(Option.isNone(yield* service.readForOwner(`${token}x`)));
      assert.isTrue(Option.isNone(yield* service.readForOwner("nonsense")));

      yield* TestClock.adjust("61 seconds");
      assert.isTrue(Option.isNone(yield* service.readForOwner(token)));
    }),
  );
});
