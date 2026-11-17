import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** The icons a topic can wear in the sidebar. */
export const MAJORDOME_TOPIC_ICONS = [
  "hash",
  "dumbbell",
  "footprints",
  "wallet",
  "receipt",
  "bitcoin",
  "plane",
  "heart-pulse",
  "book-open",
  "languages",
  "briefcase",
  "home",
  "utensils",
  "music",
  "code",
  "pen-line",
  "users",
  "leaf",
  "car",
  "lightbulb",
] as const;
export const MajordomeTopicIcon = Schema.Literals(MAJORDOME_TOPIC_ICONS);
export type MajordomeTopicIcon = typeof MajordomeTopicIcon.Type;

/**
 * One of the owner's long-running topics, as `.majordome/topics.json` in the vault stores it.
 * `folder` is vault-relative and holds the topic's notes, including its running `log.md`.
 */
export const MajordomeVaultTopic = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  folder: TrimmedNonEmptyString,
  /** Chosen by the owner; without one, the sidebar picks one from the title and folder. */
  icon: Schema.optional(MajordomeTopicIcon),
});
export type MajordomeVaultTopic = typeof MajordomeVaultTopic.Type;

/** The gist of a message: one plain line, cut short. */
export const MajordomeTopicMessagePreview = Schema.Struct({
  author: Schema.Literals(["you", "agent"]),
  text: Schema.String,
});
export type MajordomeTopicMessagePreview = typeof MajordomeTopicMessagePreview.Type;

/** A topic as this server sees it: with its conversation here, once it has been opened. */
export const MajordomeTopic = Schema.Struct({
  ...MajordomeVaultTopic.fields,
  /** This server's thread for the topic; null until the topic is first opened here. */
  threadId: Schema.NullOr(ThreadId),
  /** False when the folder has been moved or deleted since. */
  folderExists: Schema.Boolean,
  /** The note to open the folder at in Notes: its log, else its README or index. */
  keyNote: Schema.NullOr(Schema.String),
  /** The conversation's latest message; null before there is one. Absent from older servers. */
  lastMessagePreview: Schema.optional(Schema.NullOr(MajordomeTopicMessagePreview)),
});
export type MajordomeTopic = typeof MajordomeTopic.Type;

/** A folder of the vault that looks like a topic, offered once to start the list. */
export const MajordomeTopicSuggestion = Schema.Struct({
  title: TrimmedNonEmptyString,
  folder: TrimmedNonEmptyString,
});
export type MajordomeTopicSuggestion = typeof MajordomeTopicSuggestion.Type;

export const MajordomeTopicsInput = Schema.Struct({
  projectId: ProjectId,
});
export type MajordomeTopicsInput = typeof MajordomeTopicsInput.Type;

export const MajordomeTopicsResult = Schema.Struct({
  isVault: Schema.Boolean,
  /** In the owner's order. */
  topics: Schema.Array(MajordomeTopic),
  /** Empty once the owner has accepted or skipped them. */
  suggestions: Schema.Array(MajordomeTopicSuggestion),
  /** The vault's folders a topic can use, shallowest first, plumbing left out. */
  folders: Schema.Array(Schema.String),
  /** Where new topic folders go, from the vault's config (`projects` by default). */
  projectsFolder: Schema.String,
  /** This server's conversation behind the Routines screen, once it has been started. */
  routinesThreadId: Schema.optional(Schema.NullOr(ThreadId)),
});
export type MajordomeTopicsResult = typeof MajordomeTopicsResult.Type;

export const MajordomeCreateTopicInput = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  /** Vault-relative. */
  folder: TrimmedNonEmptyString,
  /** Creates the folder, with a short README.md, when it does not exist yet. */
  createFolder: Schema.Boolean,
  /** "Make this a topic": the chat that becomes the topic's conversation. */
  threadId: Schema.optional(ThreadId),
});
export type MajordomeCreateTopicInput = typeof MajordomeCreateTopicInput.Type;

export const MajordomeSuggestTopicFolderInput = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  /** "Make this a topic": the chat, whose first message says more than its title. */
  threadId: Schema.optional(ThreadId),
});
export type MajordomeSuggestTopicFolderInput = typeof MajordomeSuggestTopicFolderInput.Type;

/** Where a new topic's notes could go. Vault-relative; `existing` when the folder is already there. */
export const MajordomeSuggestTopicFolderResult = Schema.Struct({
  folder: Schema.String,
  existing: Schema.Boolean,
});
export type MajordomeSuggestTopicFolderResult = typeof MajordomeSuggestTopicFolderResult.Type;

export const MajordomeUpdateTopicInput = Schema.Struct({
  projectId: ProjectId,
  topicId: TrimmedNonEmptyString,
  title: Schema.optional(TrimmedNonEmptyString),
  folder: Schema.optional(TrimmedNonEmptyString),
  createFolder: Schema.optional(Schema.Boolean),
  /** Null goes back to the icon picked from the title and folder. */
  icon: Schema.optional(Schema.NullOr(MajordomeTopicIcon)),
});
export type MajordomeUpdateTopicInput = typeof MajordomeUpdateTopicInput.Type;

export const MajordomeTopicRefInput = Schema.Struct({
  projectId: ProjectId,
  topicId: TrimmedNonEmptyString,
});
export type MajordomeTopicRefInput = typeof MajordomeTopicRefInput.Type;

export const MajordomeReorderTopicsInput = Schema.Struct({
  projectId: ProjectId,
  /** Every topic id, in the new order. Ids it leaves out keep their place at the end. */
  topicIds: Schema.Array(TrimmedNonEmptyString),
});
export type MajordomeReorderTopicsInput = typeof MajordomeReorderTopicsInput.Type;

export const MajordomeOpenRoutinesConversationInput = Schema.Struct({
  projectId: ProjectId,
  /** Starts a new conversation and lets the previous one go to the recent chats. */
  fresh: Schema.optional(Schema.Boolean),
  /** The id a conversation started now gets, so the asking client can keep it out of its lists at once. */
  threadId: Schema.optional(ThreadId),
});
export type MajordomeOpenRoutinesConversationInput =
  typeof MajordomeOpenRoutinesConversationInput.Type;

export const MajordomeOpenTopicResult = Schema.Struct({
  threadId: ThreadId,
});
export type MajordomeOpenTopicResult = typeof MajordomeOpenTopicResult.Type;

export class MajordomeTopicsError extends Schema.TaggedError<MajordomeTopicsError>()(
  "MajordomeTopicsError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
