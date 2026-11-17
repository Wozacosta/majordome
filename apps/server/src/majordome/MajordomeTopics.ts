/**
 * Topics for a vault project: the list (in the vault's `.majordome/topics.json`), this server's
 * thread for each one (created the first time the topic is opened), the first-topic suggestions,
 * and "Make this a topic" for an existing chat. Topic threads never settle on their own; removing
 * a topic hands its thread back to the recent chats and never touches the notes.
 */

import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type MajordomeCreateTopicInput,
  type MajordomeOpenRoutinesConversationInput,
  type MajordomeOpenTopicResult,
  type MajordomeReorderTopicsInput,
  type MajordomeTopic,
  type MajordomeTopicRefInput,
  MajordomeTopicsError,
  type MajordomeTopicsInput,
  type MajordomeTopicsResult,
  type MajordomeUpdateTopicInput,
  type MajordomeVaultTopic,
  type MessageId,
  type OrchestrationV2ServerCommand,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  EMPTY_PROJECT_TOPIC_STATE,
  type ProjectTopicState,
  readTopicThreadsState,
  topicThreadsStatePath,
  writeTopicThreadsState,
} from "./topicThreads.ts";
import { pickTopicPreview, type TopicPreviewMessage } from "./topicPreview.ts";
import { readVaultLayout, type VaultLayout } from "./vaultConfig.ts";
import * as VaultLock from "./VaultLock.ts";
import { chooseVaultModel } from "./vaultModel.ts";
import {
  canHoldTopic,
  listVaultFolders,
  newTopicId,
  normalizeTopicFolder,
  readVaultTopics,
  reorderVaultTopics,
  suggestTopics,
  type VaultFolder,
  writeVaultTopics,
} from "./vaultTopics.ts";

export class MajordomeTopics extends Context.Service<
  MajordomeTopics,
  {
    readonly list: (
      input: MajordomeTopicsInput,
    ) => Effect.Effect<MajordomeTopicsResult, MajordomeTopicsError>;
    readonly create: (
      input: MajordomeCreateTopicInput,
    ) => Effect.Effect<MajordomeTopic, MajordomeTopicsError>;
    readonly update: (
      input: MajordomeUpdateTopicInput,
    ) => Effect.Effect<MajordomeTopic, MajordomeTopicsError>;
    readonly reorder: (
      input: MajordomeReorderTopicsInput,
    ) => Effect.Effect<void, MajordomeTopicsError>;
    readonly remove: (input: MajordomeTopicRefInput) => Effect.Effect<void, MajordomeTopicsError>;
    /** The topic's thread on this server, started now if it has none yet. */
    readonly open: (
      input: MajordomeTopicRefInput,
    ) => Effect.Effect<MajordomeOpenTopicResult, MajordomeTopicsError>;
    /** The thread behind the Routines screen on this server, started now if there is none. */
    readonly openRoutinesConversation: (
      input: MajordomeOpenRoutinesConversationInput,
    ) => Effect.Effect<MajordomeOpenTopicResult, MajordomeTopicsError>;
    readonly dismissSuggestions: (
      input: MajordomeTopicsInput,
    ) => Effect.Effect<void, MajordomeTopicsError>;
  }
>()("t3/majordome/MajordomeTopics") {}

const isTopicsError = Schema.is(MajordomeTopicsError);

const ROUTINES_CONVERSATION_TITLE = "Assistant";

const KEY_NOTES = ["log.md", "README.md", "index.md"] as const;
/** Enough of the latest messages to find one with words in it. */
const PREVIEW_MESSAGE_WINDOW = 4;

const fail = (message: string) => Effect.fail(new MajordomeTopicsError({ message }));

const readmeFor = (title: string) =>
  `# ${title}\n\nNotes for the topic "${title}". Majordome keeps its running log in log.md.\n`;

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const config = yield* ServerConfig.ServerConfig;
  const vaultLock = yield* VaultLock.VaultLock;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const statePath = topicThreadsStatePath(path, config.stateDir);
  // One change at a time, so two quick edits never write over each other.
  const lock = yield* Semaphore.make(1);

  const provideFs = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  const vaultOf = Effect.fn("MajordomeTopics.vaultOf")(function* (
    projectId: MajordomeTopicsInput["projectId"],
  ) {
    const project = Option.getOrUndefined(yield* projects.get(projectId));
    if (project === undefined) return undefined;
    const layout = yield* provideFs(readVaultLayout(project.workspaceRoot));
    return Option.isSome(layout) ? { project, layout: layout.value } : undefined;
  });

  const requireVault = (projectId: MajordomeTopicsInput["projectId"]) =>
    vaultOf(projectId).pipe(
      Effect.filterOrFail(
        (vault) => vault !== undefined,
        () => new MajordomeTopicsError({ message: "That notes folder was not found." }),
      ),
    );

  const projectState = (projectId: string) =>
    provideFs(readTopicThreadsState(statePath)).pipe(
      Effect.map((state) => state.projects[projectId] ?? EMPTY_PROJECT_TOPIC_STATE),
    );

  const updateProjectState = Effect.fn("MajordomeTopics.updateProjectState")(function* (
    projectId: string,
    change: (current: ProjectTopicState) => ProjectTopicState,
  ) {
    const state = yield* provideFs(readTopicThreadsState(statePath));
    const next = change(state.projects[projectId] ?? EMPTY_PROJECT_TOPIC_STATE);
    yield* provideFs(
      writeTopicThreadsState(statePath, { projects: { ...state.projects, [projectId]: next } }),
    );
  });

  const writeTopics = (vaultRoot: string, topics: ReadonlyArray<MajordomeVaultTopic>) =>
    vaultLock.withLock(vaultRoot, provideFs(writeVaultTopics({ vaultRoot, topics })));

  const isFolder = (absolute: string) =>
    fileSystem.stat(absolute).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

  /** The cleaned folder, created with a README when asked and missing. */
  const resolveFolder = Effect.fn("MajordomeTopics.resolveFolder")(function* (input: {
    readonly vaultRoot: string;
    readonly layout: VaultLayout;
    readonly folder: string;
    readonly createFolder: boolean;
    readonly title: string;
  }) {
    const folder = normalizeTopicFolder(input.folder);
    if (folder === null) return yield* fail("Choose a folder inside your notes.");
    if (!canHoldTopic(folder, input.layout)) {
      return yield* fail(
        `${folder} is for your daily notes, inbox or files, so it can't be a topic's folder.`,
      );
    }
    const absolute = path.join(input.vaultRoot, folder);
    if (yield* isFolder(absolute)) return folder;
    if (!input.createFolder) return yield* fail(`There is no folder ${folder} in your notes.`);
    if (yield* fileSystem.exists(absolute)) {
      return yield* fail(`${folder} is a file, not a folder.`);
    }
    yield* vaultLock.withLock(
      input.vaultRoot,
      Effect.gen(function* () {
        yield* fileSystem.makeDirectory(absolute, { recursive: true });
        yield* fileSystem.writeFileString(path.join(absolute, "README.md"), readmeFor(input.title));
      }),
    );
    return folder;
  });

  /** The thread, when it still exists here and is not archived. */
  const liveThread = (threadId: ThreadId | undefined) =>
    threadId === undefined
      ? Effect.succeed(null)
      : threads.getThreadShell(threadId).pipe(
          Effect.map((shell) => (shell === null || shell.archivedAt !== null ? null : shell)),
          Effect.orElseSucceed(() => null),
        );

  const dispatch = (command: OrchestrationV2ServerCommand) => threads.dispatch(command);
  const random = yield* SecureRandom.SecureRandom;
  const commandId = (operation: string) =>
    random
      .uuidV4()
      .pipe(Effect.map((uuid) => CommandId.make(`majordome:topic:${operation}:${uuid}`)));

  /** Topic threads stay in Topics: no settling after a week, and back out of Settled. */
  const keepThreadAsTopic = Effect.fn("MajordomeTopics.keepThreadAsTopic")(function* (
    threadId: ThreadId,
    title: string | undefined,
  ) {
    const shell = yield* threads.getThreadShell(threadId);
    if (shell === null) return;
    if (shell.autoSettleDisabledAt == null) {
      yield* dispatch({
        type: "thread.auto-settle.set",
        commandId: yield* commandId("keep"),
        threadId,
        enabled: false,
      });
    }
    if (shell.settledOverride === "settled") {
      yield* dispatch({
        type: "thread.unsettle",
        commandId: yield* commandId("unsettle"),
        threadId,
        reason: "user",
      });
    }
    if (title !== undefined && shell.title !== title) {
      yield* dispatch({
        type: "thread.metadata.update",
        commandId: yield* commandId("title"),
        threadId,
        title,
      });
    }
  });

  /** The gist of the thread's latest message, read from its last few messages only. */
  const lastMessagePreview = Effect.fn("MajordomeTopics.lastMessagePreview")(
    function* (threadId: ThreadId) {
      const page = yield* threads.getTimelinePage(threadId, {
        beforePosition: Number.POSITIVE_INFINITY,
        limit: PREVIEW_MESSAGE_WINDOW,
        view: "messages",
      });
      // A message body the timeline left out is read from the message itself.
      const omitted = new Map<ThreadId, Array<MessageId>>();
      for (const { sourceThreadId, item } of page.items) {
        if (
          (item.type === "user_message" || item.type === "assistant_message") &&
          item.textOmitted
        ) {
          omitted.set(sourceThreadId, [...(omitted.get(sourceThreadId) ?? []), item.messageId]);
        }
      }
      const bodies = new Map<MessageId, string>();
      for (const [sourceThreadId, messageIds] of omitted) {
        const messages = yield* threads.getMessagesById(sourceThreadId, messageIds);
        for (const [id, message] of messages) bodies.set(id, message.text);
      }
      return pickTopicPreview(
        page.items.flatMap(({ item }): ReadonlyArray<TopicPreviewMessage> => {
          switch (item.type) {
            case "user_message":
              // Scheduled prompts and agents' messages are not the owner's words.
              return item.createdBy === "user"
                ? [{ author: "you", text: bodies.get(item.messageId) ?? item.text }]
                : [];
            case "assistant_message":
              return [{ author: "agent", text: bodies.get(item.messageId) ?? item.text }];
            case "proposed_plan":
              return [{ author: "agent", text: item.markdown }];
            default:
              return [];
          }
        }),
      );
    },
    Effect.orElseSucceed(() => null),
  );

  const viewOf = Effect.fn("MajordomeTopics.viewOf")(function* (
    vaultRoot: string,
    topic: MajordomeVaultTopic,
    state: ProjectTopicState,
  ) {
    const thread = yield* liveThread(state.threads[topic.id]);
    const folderPath = path.join(vaultRoot, topic.folder);
    const keyNote = yield* Effect.findFirst(KEY_NOTES, (name) =>
      fileSystem.exists(path.join(folderPath, name)).pipe(Effect.orElseSucceed(() => false)),
    );
    return {
      ...topic,
      threadId: thread?.id ?? null,
      folderExists: yield* isFolder(folderPath),
      keyNote: Option.match(keyNote, {
        onNone: () => null,
        onSome: (name) => `${topic.folder}/${name}`,
      }),
      lastMessagePreview: thread === null ? null : yield* lastMessagePreview(thread.id),
    } satisfies MajordomeTopic;
  });

  const findTopic = Effect.fn("MajordomeTopics.findTopic")(function* (
    vaultRoot: string,
    topicId: string,
  ) {
    const topics = yield* provideFs(readVaultTopics(vaultRoot));
    const topic = topics.find((candidate) => candidate.id === topicId);
    if (topic === undefined) return yield* fail("That topic is no longer in your notes.");
    return { topics, topic };
  });

  const suggestionsFor = (
    layout: VaultLayout,
    folders: ReadonlyArray<VaultFolder>,
    topics: ReadonlyArray<MajordomeVaultTopic>,
  ) => suggestTopics({ folders, layout, taken: new Set(topics.map((topic) => topic.folder)) });

  const toTopicsError = (message: string) => (cause: unknown) =>
    isTopicsError(cause) ? cause : new MajordomeTopicsError({ message, cause });

  const list: MajordomeTopics["Service"]["list"] = Effect.fn("MajordomeTopics.list")(
    function* (input) {
      const vault = yield* vaultOf(input.projectId);
      if (vault === undefined) {
        return { isVault: false, topics: [], suggestions: [], folders: [], projectsFolder: "" };
      }
      const vaultRoot = vault.project.workspaceRoot;
      const topics = yield* provideFs(readVaultTopics(vaultRoot));
      const state = yield* projectState(input.projectId);
      const folders = yield* provideFs(listVaultFolders(vaultRoot));
      return {
        isVault: true,
        topics: yield* Effect.forEach(topics, (topic) => viewOf(vaultRoot, topic, state)),
        suggestions: state.suggestionsDismissed
          ? []
          : suggestionsFor(vault.layout, folders, topics),
        folders: folders.flatMap((folder) =>
          canHoldTopic(folder.path, vault.layout) ? [folder.path] : [],
        ),
        projectsFolder: normalizeTopicFolder(vault.layout.projectsFolder) ?? "projects",
        routinesThreadId: (yield* liveThread(state.routinesThread))?.id ?? null,
      };
    },
    Effect.mapError(toTopicsError("Could not read your topics.")),
  );

  const create: MajordomeTopics["Service"]["create"] = Effect.fn("MajordomeTopics.create")(
    function* (input) {
      const { project, layout } = yield* requireVault(input.projectId);
      const vaultRoot = project.workspaceRoot;
      const topics = yield* provideFs(readVaultTopics(vaultRoot));
      const state = yield* projectState(input.projectId);
      if (input.threadId !== undefined) {
        const thread = yield* liveThread(input.threadId);
        if (thread === null || thread.projectId !== input.projectId) {
          return yield* fail("That chat is not in these notes.");
        }
        if (Object.values(state.threads).includes(input.threadId)) {
          return yield* fail("That chat is already a topic.");
        }
      }
      const folder = yield* resolveFolder({ vaultRoot, layout, ...input });
      if (topics.some((topic) => topic.folder === folder)) {
        return yield* fail(`Another topic already uses ${folder}.`);
      }
      const topic: MajordomeVaultTopic = {
        id: newTopicId(input.title, new Set(topics.map((candidate) => candidate.id))),
        title: input.title,
        folder,
      };
      yield* writeTopics(vaultRoot, [...topics, topic]);
      const adopted = input.threadId;
      if (adopted !== undefined) {
        yield* updateProjectState(input.projectId, (current) => ({
          ...current,
          threads: { ...current.threads, [topic.id]: adopted },
        }));
        yield* keepThreadAsTopic(adopted, topic.title);
      }
      return yield* viewOf(vaultRoot, topic, yield* projectState(input.projectId));
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(toTopicsError("Could not add this topic.")),
  );

  const update: MajordomeTopics["Service"]["update"] = Effect.fn("MajordomeTopics.update")(
    function* (input) {
      const { project, layout } = yield* requireVault(input.projectId);
      const vaultRoot = project.workspaceRoot;
      const { topics, topic } = yield* findTopic(vaultRoot, input.topicId);
      const title = input.title ?? topic.title;
      const folder =
        input.folder === undefined
          ? topic.folder
          : yield* resolveFolder({
              vaultRoot,
              layout,
              folder: input.folder,
              createFolder: input.createFolder ?? false,
              title,
            });
      if (topics.some((other) => other.id !== topic.id && other.folder === folder)) {
        return yield* fail(`Another topic already uses ${folder}.`);
      }
      const { icon: _previousIcon, ...rest } = topic;
      const icon = input.icon === undefined ? topic.icon : (input.icon ?? undefined);
      const next: MajordomeVaultTopic = {
        ...rest,
        title,
        folder,
        ...(icon === undefined ? {} : { icon }),
      };
      yield* writeTopics(
        vaultRoot,
        topics.map((candidate) => (candidate.id === topic.id ? next : candidate)),
      );
      const state = yield* projectState(input.projectId);
      const thread = yield* liveThread(state.threads[topic.id]);
      if (thread !== null && input.title !== undefined) {
        yield* keepThreadAsTopic(thread.id, title);
      }
      return yield* viewOf(vaultRoot, next, state);
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(toTopicsError("Could not change this topic.")),
  );

  const reorder: MajordomeTopics["Service"]["reorder"] = Effect.fn("MajordomeTopics.reorder")(
    function* (input) {
      const { project } = yield* requireVault(input.projectId);
      const vaultRoot = project.workspaceRoot;
      const topics = yield* provideFs(readVaultTopics(vaultRoot));
      yield* writeTopics(vaultRoot, reorderVaultTopics(topics, input.topicIds));
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(toTopicsError("Could not reorder your topics.")),
  );

  const remove: MajordomeTopics["Service"]["remove"] = Effect.fn("MajordomeTopics.remove")(
    function* (input) {
      const { project } = yield* requireVault(input.projectId);
      const vaultRoot = project.workspaceRoot;
      const topics = yield* provideFs(readVaultTopics(vaultRoot));
      yield* writeTopics(
        vaultRoot,
        topics.filter((topic) => topic.id !== input.topicId),
      );
      const state = yield* projectState(input.projectId);
      const threadId = state.threads[input.topicId];
      if (threadId === undefined) return;
      const { [input.topicId]: _removed, ...rest } = state.threads;
      yield* updateProjectState(input.projectId, (current) => ({ ...current, threads: rest }));
      // The conversation stays, as a recent chat that settles like the others.
      yield* releaseThread(threadId);
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(toTopicsError("Could not remove this topic.")),
  );

  /** A new thread in the vault that stays out of Settled, as a topic's conversation does. */
  const startKeptThread = Effect.fn("MajordomeTopics.startKeptThread")(function* (
    project: ProjectStore.ProjectRow,
    title: string,
    requestedThreadId?: ThreadId,
  ) {
    const modelSelection = yield* chooseVaultModel(project).pipe(
      Effect.provideService(ServerSettings.ServerSettingsService, settings),
      Effect.provideService(ThreadManagementService.ThreadManagementService, threads),
      Effect.provideService(ProviderRegistry.ProviderRegistry, providers),
    );
    if (modelSelection === null) {
      return yield* fail("No AI provider is ready yet. Set one up in Settings, then try again.");
    }
    const threadId = requestedThreadId ?? ThreadId.make(yield* random.uuidV4());
    yield* dispatch({
      type: "thread.create",
      createdBy: "user",
      creationSource: "server",
      commandId: yield* commandId("create"),
      threadId,
      projectId: project.projectId,
      title,
      modelSelection,
      runtimeMode: (yield* settings.getSettings).defaultRuntimeMode,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
    });
    yield* keepThreadAsTopic(threadId, undefined);
    return threadId;
  });

  /** Lets a thread that was kept settle again, as a recent chat. */
  const releaseThread = Effect.fn("MajordomeTopics.releaseThread")(function* (threadId: ThreadId) {
    if ((yield* liveThread(threadId)) === null) return;
    yield* dispatch({
      type: "thread.auto-settle.set",
      commandId: yield* commandId("release"),
      threadId,
      enabled: true,
    });
  });

  const open: MajordomeTopics["Service"]["open"] = Effect.fn("MajordomeTopics.open")(
    function* (input) {
      const { project } = yield* requireVault(input.projectId);
      const { topic } = yield* findTopic(project.workspaceRoot, input.topicId);
      const state = yield* projectState(input.projectId);
      const existing = yield* liveThread(state.threads[topic.id]);
      if (existing !== null) return { threadId: existing.id };
      const threadId = yield* startKeptThread(project, topic.title);
      yield* updateProjectState(input.projectId, (current) => ({
        ...current,
        threads: { ...current.threads, [topic.id]: threadId },
      }));
      return { threadId };
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(toTopicsError("Could not open this topic.")),
  );

  const openRoutinesConversation: MajordomeTopics["Service"]["openRoutinesConversation"] =
    Effect.fn("MajordomeTopics.openRoutinesConversation")(
      function* (input) {
        const { project } = yield* requireVault(input.projectId);
        const previous = (yield* projectState(input.projectId)).routinesThread;
        const existing = yield* liveThread(previous);
        if (existing !== null && input.fresh !== true) return { threadId: existing.id };
        const threadId = yield* startKeptThread(
          project,
          ROUTINES_CONVERSATION_TITLE,
          input.threadId,
        );
        yield* updateProjectState(input.projectId, (current) => ({
          ...current,
          routinesThread: threadId,
        }));
        if (previous !== undefined) yield* releaseThread(previous);
        return { threadId };
      },
      (effect) => lock.withPermits(1)(effect),
      Effect.mapError(toTopicsError("Could not open the assistant for your routines.")),
    );

  const dismissSuggestions: MajordomeTopics["Service"]["dismissSuggestions"] = Effect.fn(
    "MajordomeTopics.dismissSuggestions",
  )(
    function* (input) {
      yield* requireVault(input.projectId);
      yield* updateProjectState(input.projectId, (current) => ({
        ...current,
        suggestionsDismissed: true,
      }));
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(toTopicsError("Could not hide the suggestions.")),
  );

  return MajordomeTopics.of({
    list,
    create,
    update,
    reorder,
    remove,
    open,
    openRoutinesConversation,
    dismissSuggestions,
  });
});

export const layer = Layer.effect(MajordomeTopics, make);
