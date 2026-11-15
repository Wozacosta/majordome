import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type OrchestrationV2ServerCommand,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as MajordomeTopics from "./MajordomeTopics.ts";
import * as VaultLock from "./VaultLock.ts";

const vaultProject = ProjectId.make("vault-project");
const codeProject = ProjectId.make("code-project");
const model = { instanceId: "replay", model: "replay" } as ModelSelection;

interface FakeThread {
  id: ThreadId;
  projectId: ProjectId;
  title: string;
  archivedAt: string | null;
  settledOverride: "settled" | "active" | null;
  autoSettleDisabledAt: string | null;
  modelSelection: ModelSelection;
}

const projectRow = (projectId: ProjectId, workspaceRoot: string) =>
  ({
    projectId,
    title: "Notes",
    workspaceRoot,
    defaultModelSelection: null,
    archivedAt: null,
  }) as unknown as ProjectStore.ProjectRow;

/** A thread store that applies the commands the service sends, and remembers them. */
const fakeThreads = () => {
  const threads = new Map<string, FakeThread>();
  const commands: Array<OrchestrationV2ServerCommand> = [];
  const service = Layer.mock(ThreadManagementService.ThreadManagementService)({
    getThreadShell: (threadId) => Effect.succeed((threads.get(threadId) ?? null) as never),
    listProjectThreads: () => Effect.succeed([]),
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        if (command.type === "thread.create") {
          threads.set(command.threadId, {
            id: command.threadId,
            projectId: command.projectId,
            title: command.title,
            archivedAt: null,
            settledOverride: null,
            autoSettleDisabledAt: null,
            modelSelection: command.modelSelection,
          });
        }
        const thread = "threadId" in command ? threads.get(command.threadId) : undefined;
        if (thread === undefined) return { sequence: commands.length } as never;
        if (command.type === "thread.auto-settle.set") {
          thread.autoSettleDisabledAt = command.enabled ? null : "2026-11-15T09:00:00.000Z";
        } else if (command.type === "thread.unsettle") {
          thread.settledOverride = null;
        } else if (command.type === "thread.metadata.update" && command.title !== undefined) {
          thread.title = command.title;
        }
        return { sequence: commands.length } as never;
      }),
  });
  return { threads, commands, service };
};

const setUp = Effect.fn("test.setUp")(function* (
  options: { readonly defaultModel?: ModelSelection | null } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const vault = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-topics-vault-" });
  const code = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-topics-code-" });
  const write = (relativePath: string, text: string) =>
    Effect.gen(function* () {
      const filePath = `${vault}/${relativePath}`;
      yield* fs.makeDirectory(filePath.slice(0, filePath.lastIndexOf("/")), { recursive: true });
      yield* fs.writeFileString(filePath, text);
    });
  yield* write(".majordome/config.json", "{}");
  yield* write(".majordome/runner", "env-nowhere\n");
  yield* write("personal/fitness/log.md", "- Ran 5k\n");
  yield* write("projects/lisbon-move/visas.md", "# Visas\n");
  yield* write("daily/2026-11-15.md", "- Today\n");
  yield* write("inbox/scan.md", "scan\n");
  const fake = fakeThreads();
  const roots: Record<string, string> = { [vaultProject]: vault, [codeProject]: code };
  const service = yield* Effect.service(MajordomeTopics.MajordomeTopics).pipe(
    Effect.provide(
      MajordomeTopics.layer.pipe(
        Layer.provide(VaultLock.layer),
        Layer.provide(fake.service),
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: (projectId) =>
              Effect.succeed(
                roots[projectId] === undefined
                  ? Option.none()
                  : Option.some(projectRow(projectId, roots[projectId]!)),
              ),
          }),
        ),
        Layer.provide(
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Effect.succeed({
              ...DEFAULT_SERVER_SETTINGS,
              defaultModelSelection:
                options.defaultModel === undefined ? model : options.defaultModel,
            }),
          }),
        ),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-topics-" })),
        Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      ),
    ),
  );
  return { service, fake, vault, fs };
});

const errorMessage = <A, E extends { readonly message: string }>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit)
    ? Option.match(Exit.findErrorOption(exit), { onNone: () => "", onSome: (e) => e.message })
    : "";

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("MajordomeTopics", (it) => {
  it.effect("is empty for a project that is not a vault", () =>
    Effect.gen(function* () {
      const { service } = yield* setUp();
      const result = yield* service.list({ projectId: codeProject });
      assert.isFalse(result.isVault);
      assert.deepEqual(result.topics, []);
    }),
  );

  it.effect("suggests first topics from the vault's folders until they are skipped", () =>
    Effect.gen(function* () {
      const { service } = yield* setUp();
      const first = yield* service.list({ projectId: vaultProject });
      assert.isTrue(first.isVault);
      assert.equal(first.projectsFolder, "projects");
      assert.includeMembers([...first.folders], ["personal/fitness", "projects/lisbon-move"]);
      assert.deepEqual(first.suggestions, [
        { title: "Lisbon move", folder: "projects/lisbon-move" },
        { title: "Fitness", folder: "personal/fitness" },
      ]);

      yield* service.create({
        projectId: vaultProject,
        title: "Fitness",
        folder: "personal/fitness",
        createFolder: false,
      });
      const accepted = yield* service.list({ projectId: vaultProject });
      assert.deepEqual(
        accepted.suggestions.map((suggestion) => suggestion.folder),
        ["projects/lisbon-move"],
      );

      yield* service.dismissSuggestions({ projectId: vaultProject });
      assert.deepEqual((yield* service.list({ projectId: vaultProject })).suggestions, []);
    }),
  );

  it.effect("stores topics in the vault and creates a new folder with a short README", () =>
    Effect.gen(function* () {
      const { service, vault, fs } = yield* setUp();
      const topic = yield* service.create({
        projectId: vaultProject,
        title: "Quitting nicotine",
        folder: "projects/quitting-nicotine",
        createFolder: true,
      });
      assert.deepEqual(topic, {
        id: "quitting-nicotine",
        title: "Quitting nicotine",
        folder: "projects/quitting-nicotine",
        threadId: null,
        folderExists: true,
      });
      assert.include(
        yield* fs.readFileString(`${vault}/projects/quitting-nicotine/README.md`),
        "# Quitting nicotine",
      );
      assert.deepEqual(JSON.parse(yield* fs.readFileString(`${vault}/.majordome/topics.json`)), {
        topics: [
          {
            id: "quitting-nicotine",
            title: "Quitting nicotine",
            folder: "projects/quitting-nicotine",
          },
        ],
      });
    }),
  );

  it.effect("refuses folders outside the vault, missing ones and ones another topic uses", () =>
    Effect.gen(function* () {
      const { service } = yield* setUp();
      const create = (folder: string, createFolder = false) =>
        service
          .create({ projectId: vaultProject, title: "Topic", folder, createFolder })
          .pipe(Effect.exit);
      assert.equal(
        errorMessage(yield* create("../elsewhere", true)),
        "Choose a folder inside your notes.",
      );
      assert.equal(
        errorMessage(yield* create("personal/nowhere")),
        "There is no folder personal/nowhere in your notes.",
      );
      yield* create("personal/fitness");
      assert.equal(
        errorMessage(yield* create("personal/fitness")),
        "Another topic already uses personal/fitness.",
      );
    }),
  );

  it.effect("starts a topic's thread the first time it opens and keeps it out of settling", () =>
    Effect.gen(function* () {
      const { service, fake } = yield* setUp();
      const topic = yield* service.create({
        projectId: vaultProject,
        title: "Fitness",
        folder: "personal/fitness",
        createFolder: false,
      });
      const { threadId } = yield* service.open({ projectId: vaultProject, topicId: topic.id });
      const thread = fake.threads.get(threadId)!;
      assert.equal(thread.title, "Fitness");
      assert.equal(thread.projectId, vaultProject);
      assert.isNotNull(thread.autoSettleDisabledAt);
      const created = fake.commands.find((command) => command.type === "thread.create");
      assert.deepInclude(created, { branch: null, worktreePath: null, modelSelection: model });

      const again = yield* service.open({ projectId: vaultProject, topicId: topic.id });
      assert.equal(again.threadId, threadId);
      assert.lengthOf(
        fake.commands.filter((command) => command.type === "thread.create"),
        1,
      );
      const listed = yield* service.list({ projectId: vaultProject });
      assert.equal(listed.topics[0]?.threadId, threadId);

      // A deleted conversation starts over; the topic's memory is its folder.
      fake.threads.delete(threadId);
      const fresh = yield* service.open({ projectId: vaultProject, topicId: topic.id });
      assert.notEqual(fresh.threadId, threadId);
    }),
  );

  it.effect("says what to do when it has no model to start the thread with", () =>
    Effect.gen(function* () {
      const { service } = yield* setUp({ defaultModel: null });
      const topic = yield* service.create({
        projectId: vaultProject,
        title: "Fitness",
        folder: "personal/fitness",
        createFolder: false,
      });
      const exit = yield* service
        .open({ projectId: vaultProject, topicId: topic.id })
        .pipe(Effect.exit);
      assert.include(errorMessage(exit), "Start a chat or choose a default model");
    }),
  );

  it.effect("makes a recent chat a topic, and hands it back when the topic is removed", () =>
    Effect.gen(function* () {
      const { service, fake, vault, fs } = yield* setUp();
      const chatId = ThreadId.make("chat-1");
      fake.threads.set(chatId, {
        id: chatId,
        projectId: vaultProject,
        title: "Running plans",
        archivedAt: null,
        settledOverride: "settled",
        autoSettleDisabledAt: null,
        modelSelection: model,
      });
      const topic = yield* service.create({
        projectId: vaultProject,
        title: "Fitness",
        folder: "personal/fitness",
        createFolder: false,
        threadId: chatId,
      });
      assert.equal(topic.threadId, chatId);
      const adopted = fake.threads.get(chatId)!;
      assert.equal(adopted.title, "Fitness");
      assert.isNull(adopted.settledOverride);
      assert.isNotNull(adopted.autoSettleDisabledAt);
      assert.equal(
        (yield* service.open({ projectId: vaultProject, topicId: topic.id })).threadId,
        chatId,
      );

      const twice = yield* service
        .create({
          projectId: vaultProject,
          title: "Again",
          folder: "projects/lisbon-move",
          createFolder: false,
          threadId: chatId,
        })
        .pipe(Effect.exit);
      assert.equal(errorMessage(twice), "That chat is already a topic.");

      yield* service.remove({ projectId: vaultProject, topicId: topic.id });
      assert.deepEqual((yield* service.list({ projectId: vaultProject })).topics, []);
      assert.isNull(fake.threads.get(chatId)!.autoSettleDisabledAt);
      assert.equal(yield* fs.readFileString(`${vault}/personal/fitness/log.md`), "- Ran 5k\n");
    }),
  );

  it.effect("only adopts chats from the same vault", () =>
    Effect.gen(function* () {
      const { service, fake } = yield* setUp();
      const chatId = ThreadId.make("code-chat");
      fake.threads.set(chatId, {
        id: chatId,
        projectId: codeProject,
        title: "Refactor",
        archivedAt: null,
        settledOverride: null,
        autoSettleDisabledAt: null,
        modelSelection: model,
      });
      const exit = yield* service
        .create({
          projectId: vaultProject,
          title: "Fitness",
          folder: "personal/fitness",
          createFolder: false,
          threadId: chatId,
        })
        .pipe(Effect.exit);
      assert.equal(errorMessage(exit), "That chat is not in these notes.");
    }),
  );

  it.effect("renames, moves and reorders topics", () =>
    Effect.gen(function* () {
      const { service, fake, vault, fs } = yield* setUp();
      const create = (title: string, folder: string) =>
        service.create({ projectId: vaultProject, title, folder, createFolder: false });
      const fitness = yield* create("Fitness", "personal/fitness");
      const lisbon = yield* create("Lisbon", "projects/lisbon-move");
      const { threadId } = yield* service.open({ projectId: vaultProject, topicId: fitness.id });

      const renamed = yield* service.update({
        projectId: vaultProject,
        topicId: fitness.id,
        title: "Running",
        folder: "personal/running",
        createFolder: true,
      });
      assert.deepInclude(renamed, { title: "Running", folder: "personal/running", threadId });
      assert.equal(fake.threads.get(threadId)!.title, "Running");
      assert.isTrue(yield* fs.exists(`${vault}/personal/running/README.md`));

      yield* service.reorder({ projectId: vaultProject, topicIds: [lisbon.id, fitness.id] });
      assert.deepEqual(
        (yield* service.list({ projectId: vaultProject })).topics.map((topic) => topic.title),
        ["Lisbon", "Running"],
      );
    }),
  );
});
