/**
 * What one chat's assistant has, for the owner to see drawn: what it read before the first
 * message, what it can use, and what it can reach. The assistant is given names only; the map adds
 * the start of the notes it loaded, for the owner. Never a key's value or a private document. The assistant asks for it with `describe_setup`, which also draws it.
 */

import {
  MajordomeTopicsError,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import { clampHtmlRenderHeight, injectHtmlRenderBootstrap } from "@t3tools/shared/htmlRender";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { createAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { renderChatSetupPage } from "./chatSetupPage.ts";
import * as MajordomeConnectors from "./MajordomeConnectors.ts";
import * as MajordomePrivateDocuments from "./MajordomePrivateDocuments.ts";
import * as MajordomeSavedKeys from "./MajordomeSavedKeys.ts";
import * as MajordomeSkills from "./MajordomeSkills.ts";
import * as MajordomeTopicFiles from "./MajordomeTopicFiles.ts";
import * as MajordomeTopics from "./MajordomeTopics.ts";
import { plainTools, sessionTools } from "./sessionTools.ts";

/** The files every provider reads as standing instructions, at the top of the notes folder. */
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
/** Enough for a drawing; the totals say when there are more. */
const OTHER_TOPICS_SHOWN = 12;
const TOPIC_FILES_SHOWN = 40;
/** A loaded note as the map shows it when opened: its start. */
const NOTE_TEXT_SHOWN = 1_500;

export type ChatSetupPart =
  | "skills"
  | "connections"
  | "topic files"
  | "saved keys"
  | "private documents";

export const readChatSetup = Effect.fn("majordome.readChatSetup")(function* (
  thread: Pick<
    OrchestrationV2ThreadShell,
    "id" | "projectId" | "providerInstanceId" | "worktreePath"
  >,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const topics = yield* MajordomeTopics.MajordomeTopics;
  const skills = yield* MajordomeSkills.MajordomeSkills;
  const connectors = yield* MajordomeConnectors.MajordomeConnectors;
  const topicFiles = yield* MajordomeTopicFiles.MajordomeTopicFiles;
  const savedKeys = yield* MajordomeSavedKeys.MajordomeSavedKeys;
  const privateDocuments = yield* MajordomePrivateDocuments.MajordomePrivateDocuments;
  const environment = yield* ServerEnvironment.ServerEnvironment;

  // A part that could not be read is named, so the drawing never shows it as empty.
  const unread: Array<ChatSetupPart> = [];
  const orUnread = <A, E, R>(part: ChatSetupPart, read: Effect.Effect<A, E, R>) =>
    read.pipe(
      Effect.asSome,
      Effect.catch((cause) =>
        Effect.logWarning("Could not read a part of a chat's setup.", { part, cause }).pipe(
          Effect.map(() => {
            unread.push(part);
            return Option.none<A>();
          }),
        ),
      ),
    );

  const knowledge = yield* topics.chatKnowledge({ threadId: thread.id });
  const folder =
    thread.worktreePath ??
    Option.getOrUndefined(
      yield* projects.get(thread.projectId).pipe(Effect.orElseSucceed(Option.none)),
    )?.workspaceRoot;

  const instructions: Array<string> = [];
  if (folder !== undefined) {
    for (const name of INSTRUCTION_FILES) {
      const exists = yield* fileSystem
        .exists(path.join(folder, name))
        .pipe(Effect.orElseSucceed(() => false));
      if (exists) instructions.push(name);
    }
  }

  // What the map shows when a box is opened. It goes to the owner's screen, not to the assistant,
  // which has these notes already.
  const texts: Record<string, string> = {};
  if (folder !== undefined) {
    const loaded = [
      ...instructions,
      ...(knowledge.memory === null ? [] : [knowledge.memory.path]),
      ...knowledge.dailyNotes.map((note) => note.path),
    ];
    for (const name of loaded) {
      const text = yield* fileSystem.readFileString(path.join(folder, name)).pipe(Effect.option);
      if (Option.isNone(text) || text.value.trim() === "") continue;
      const trimmed = text.value.trim();
      texts[name] =
        trimmed.length <= NOTE_TEXT_SHOWN ? trimmed : `${trimmed.slice(0, NOTE_TEXT_SHOWN)}…`;
    }
  }

  const kept = yield* orUnread("skills", skills.list({ projectId: thread.projectId }));
  const reached = (yield* connectors.list({})).providers.find(
    (provider) => provider.instanceId === thread.providerInstanceId,
  );
  if (reached?.error !== undefined) unread.push("connections");
  const files =
    knowledge.topic === null
      ? Option.none()
      : yield* orUnread(
          "topic files",
          topicFiles.list({ projectId: thread.projectId, topicId: knowledge.topic.id }),
        );
  const keys = yield* orUnread("saved keys", savedKeys.list());
  const documents = yield* orUnread("private documents", privateDocuments.list());
  const { label } = yield* environment.getDescriptor;

  const facts = {
    startsWith: {
      instructions,
      skills: Option.match(kept, {
        onNone: () => [],
        onSome: (value) => value.skills.map(({ name, description }) => ({ name, description })),
      }),
      ...(knowledge.memory === null ? {} : { memoryNote: knowledge.memory.path }),
      dailyNotes: knowledge.dailyNotes.map((note) => note.path),
      ...(knowledge.topic === null
        ? {}
        : { topic: { title: knowledge.topic.title, folder: knowledge.topic.folder } }),
      otherTopics: knowledge.otherTopics.slice(0, OTHER_TOPICS_SHOWN).map((topic) => topic.title),
      otherTopicsTotal: knowledge.otherTopics.length,
    },
    // No connections at all when this AI account cannot say which it has.
    canUse:
      reached?.reported === true && reached.error === undefined
        ? { connections: reached.connectors.map(({ name, status }) => ({ name, status })) }
        : {},
    canReach: {
      computer: label,
      ...(folder !== undefined && knowledge.isVault ? { notesFolder: folder } : {}),
      ...Option.match(files, {
        onNone: () => ({}),
        onSome: (value) => ({
          topicFiles: value.files.slice(0, TOPIC_FILES_SHOWN).map((file) => file.name),
          topicFilesTotal: value.total,
        }),
      }),
      // A key that signs Majordome in to a source is not the assistant's to use.
      savedKeys: Option.match(keys, {
        onNone: () => [],
        onSome: (value) =>
          value.keys
            .filter((key) => key.signsInTo === undefined)
            .map(({ name, note }) => ({ name, note })),
      }),
      privateDocuments: Option.match(documents, {
        onNone: () => [],
        onSome: (value) => value.documents.map((document) => document.name),
      }),
    },
    ...(unread.length === 0 ? {} : { couldNotRead: unread }),
  };
  return {
    facts,
    opened: {
      texts,
      standings: Object.fromEntries(
        knowledge.otherTopics.flatMap((topic) =>
          topic.standing === null ? [] : [[topic.title, topic.standing]],
        ),
      ),
      documents: Object.fromEntries(
        Option.match(documents, {
          onNone: () => [],
          onSome: (value) => value.documents.map(({ name, description }) => [name, description]),
        }),
      ),
    },
  };
});

type ChatSetupRead = Effect.Success<ReturnType<typeof readChatSetup>>;
export type ChatSetup = ChatSetupRead["facts"];
export type ChatSetupOpened = ChatSetupRead["opened"];

/**
 * The map for a chat, drawn and stored as a page of that chat, for the app to open without asking
 * the assistant. The assistant's own tools are the ones its last session reported, when one has.
 */
export const drawChatSetup = Effect.fn("majordome.drawChatSetup")(function* (threadId: ThreadId) {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const fileSystem = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const thread = yield* threads
    .getThreadShell(threadId)
    .pipe(
      Effect.mapError(
        (cause) => new MajordomeTopicsError({ message: "This chat could not be read.", cause }),
      ),
    );
  if (thread === null || thread.deletedAt !== null) {
    return yield* new MajordomeTopicsError({ message: "This chat no longer exists." });
  }
  const { facts: setup, opened } = yield* readChatSetup(thread);
  const { html, height } = renderChatSetupPage({
    setup,
    opened,
    tools: plainTools(sessionTools(thread.id, thread.providerInstanceId) ?? []),
  });
  // Stored the way `html_render` stores a page, so the app's own frame shows it.
  const attachmentId = createAttachmentId(threadId, "html");
  const filePath =
    attachmentId === null
      ? null
      : resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: `${attachmentId}.html`,
        });
  if (attachmentId === null || filePath === null) {
    return yield* new MajordomeTopicsError({ message: "The map could not be drawn." });
  }
  yield* fileSystem
    .writeFileString(filePath, injectHtmlRenderBootstrap(html))
    .pipe(
      Effect.mapError(
        (cause) => new MajordomeTopicsError({ message: "The map could not be drawn.", cause }),
      ),
    );
  return {
    attachmentId,
    title: setup.startsWith.topic?.title ?? "This chat",
    height: clampHtmlRenderHeight(height),
  };
});
