import { scopedProjectKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  MajordomeSuggestTopicFolderResult,
  MajordomeReadyTopic,
  MajordomeTopic,
  MajordomeTopicSuggestion,
  MajordomeTopicsResult,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

import { defaultTopicFolder } from "@t3tools/shared/topicFolder";

import { groupBrains } from "./brains.logic";
import type { ConversationHome } from "./home.logic";

/** A topic with the server its conversation is on. */
export interface VaultTopic extends MajordomeTopic {
  /** The server the topic's conversation is on: see `mergeVaultCopies`. */
  readonly threadEnvironmentId: EnvironmentId;
  /**
   * The topic's conversations on the computers that are not its home, listed under it; empty
   * ones left out.
   */
  readonly otherChats?: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  }>;
  /** The other chats about this topic, on every server, listed under it. */
  readonly sideChats?: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  }>;
}

export interface MajordomeVault {
  /** `brainKey` of the brain, or the copy's `scopedProjectKey` for one server's copy. */
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly brainId: string | null;
  readonly topics: ReadonlyArray<VaultTopic>;
  readonly suggestions: ReadonlyArray<MajordomeTopicSuggestion>;
  /** How many suggestions the owner skipped and can ask for again. */
  readonly skippedSuggestions?: number;
  /** Ready-made topics the owner has not added, for "New topic". */
  readonly readyTopics?: ReadonlyArray<MajordomeReadyTopic>;
  readonly folders: ReadonlyArray<string>;
  readonly projectsFolder: string;
  /** Every server's copy of this brain, the shown one first. */
  readonly copies: ReadonlyArray<VaultCopy>;
  /** Where this brain's conversations are kept, once its copies are merged and it is known. */
  readonly home?: ConversationHome;
}

export interface VaultCopy {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** That server's conversation behind the Routines screen; null until it is started. */
  readonly routinesThreadId: ThreadId | null;
}

interface ListedProject {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly title: string;
}

/**
 * Each server's copy of a vault among the projects, from each project's topic list (null while it
 * loads) and brain id (undefined while it loads; left out, none is known). Projects that are not
 * vaults are left out: Majordome shows only vaults.
 */
export function collectVaults(
  projects: ReadonlyArray<ListedProject>,
  results: ReadonlyArray<MajordomeTopicsResult | null | undefined>,
  brainIds?: ReadonlyArray<string | null | undefined>,
): { readonly vaults: ReadonlyArray<MajordomeVault>; readonly loading: boolean } {
  const vaults: Array<MajordomeVault> = [];
  let loading = false;
  projects.forEach((project, index) => {
    const result = results[index];
    const brainId = brainIds === undefined ? null : brainIds[index];
    if (result == null || brainId === undefined) {
      loading = true;
      return;
    }
    if (!result.isVault) return;
    const ref = { environmentId: project.environmentId, projectId: project.id };
    const copy = { ...ref, routinesThreadId: result.routinesThreadId ?? null };
    vaults.push({
      key: scopedProjectKey(ref),
      ...ref,
      title: project.title,
      brainId,
      topics: result.topics.map((topic) => ({
        ...topic,
        threadEnvironmentId: project.environmentId,
        sideChats: (topic.sideThreadIds ?? []).map((threadId) => ({
          environmentId: project.environmentId,
          threadId,
        })),
      })),
      suggestions: result.suggestions,
      skippedSuggestions: result.skippedSuggestions ?? 0,
      readyTopics: result.readyTopics ?? [],
      folders: result.folders,
      projectsFolder: result.projectsFolder,
      copies: [copy],
    });
  });
  return { vaults, loading };
}

/**
 * One vault per brain: the window's own server's copy, else the first. Each server keeps its own
 * thread per topic. A topic opens the shown copy's, or another's when that one has none; once the
 * brain's home (`homes`, by copy key) is another computer, only that one's. The rest go under it.
 */
export function mergeVaultCopies(
  copies: ReadonlyArray<MajordomeVault>,
  primaryEnvironmentId: EnvironmentId | null,
  homes?: ReadonlyMap<string, ConversationHome>,
): ReadonlyArray<MajordomeVault> {
  return groupBrains(copies, primaryEnvironmentId).map((brain) => {
    const [shown, ...others] = brain.copies;
    const home = homes?.get(shown.key);
    // Null while the home is another computer that cannot be reached.
    const homeEnvironmentId = home?.kind === "ready" ? home.environmentId : null;
    const homeIsElsewhere =
      home?.kind === "unreachable" ||
      (homeEnvironmentId !== null && homeEnvironmentId !== shown.environmentId);
    return {
      ...shown,
      key: brain.key,
      copies: brain.copies.flatMap((copy) => copy.copies),
      ...(home === undefined ? {} : { home }),
      topics: shown.topics.map((topic) => {
        const elsewhere = others
          .flatMap((other) => other.topics)
          .filter((candidate) => candidate.id === topic.id && candidate.threadId !== null);
        const first = homeIsElsewhere
          ? elsewhere.find(
              (candidate) =>
                homeEnvironmentId === null || candidate.threadEnvironmentId === homeEnvironmentId,
            )
          : elsewhere[0];
        const main =
          !homeIsElsewhere && (topic.threadId !== null || first === undefined)
            ? topic
            : {
                ...topic,
                threadId: first?.threadId ?? null,
                threadEnvironmentId:
                  first?.threadEnvironmentId ?? homeEnvironmentId ?? shown.environmentId,
                lastMessagePreview: first?.lastMessagePreview,
              };
        const otherChats = [...(homeIsElsewhere ? [topic] : []), ...elsewhere].flatMap(
          (candidate) =>
            candidate.threadId === null ||
            candidate.threadId === main.threadId ||
            candidate.lastMessagePreview == null
              ? []
              : [{ environmentId: candidate.threadEnvironmentId, threadId: candidate.threadId }],
        );
        const sideChats = [
          ...(topic.sideChats ?? []),
          ...others
            .flatMap((other) => other.topics)
            .flatMap((candidate) => (candidate.id === topic.id ? (candidate.sideChats ?? []) : [])),
        ];
        return { ...main, sideChats, ...(otherChats.length === 0 ? {} : { otherChats }) };
      }),
    };
  });
}

/** The vault the switcher points at, else the first one. */
export function pickActiveVault(
  vaults: ReadonlyArray<MajordomeVault>,
  chosenKey: string | null,
): MajordomeVault | null {
  return vaults.find((vault) => vault.key === chosenKey) ?? vaults[0] ?? null;
}

/**
 * `scopedThreadKey`s of every thread that has its own place, in every vault: each topic's, the
 * other chats listed under a topic, and the conversation behind the Routines screen.
 */
export function topicThreadKeys(vaults: ReadonlyArray<MajordomeVault>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const vault of vaults) {
    for (const copy of vault.copies) {
      if (copy.routinesThreadId !== null) {
        keys.add(
          scopedThreadKey({ environmentId: copy.environmentId, threadId: copy.routinesThreadId }),
        );
      }
    }
    for (const topic of vault.topics) {
      if (topic.threadId !== null) {
        keys.add(
          scopedThreadKey({ environmentId: topic.threadEnvironmentId, threadId: topic.threadId }),
        );
      }
      for (const chat of topic.sideChats ?? []) keys.add(scopedThreadKey(chat));
    }
  }
  return keys;
}

/**
 * Recent: the active brain's one-off chats, on every server that has it. Topic threads have their
 * own list, and threads of projects that are not vaults are not shown at all. Nothing while no
 * vault is known yet.
 */
export function selectRecentThreads<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly projectId: ProjectId;
  },
>(
  threads: ReadonlyArray<T>,
  input: { readonly vault: MajordomeVault | null; readonly topicKeys: ReadonlySet<string> },
): ReadonlyArray<T> {
  const { vault, topicKeys } = input;
  if (vault === null) return [];
  return threads.filter(
    (thread) =>
      vault.copies.some(
        (copy) =>
          copy.environmentId === thread.environmentId && copy.projectId === thread.projectId,
      ) &&
      !topicKeys.has(scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id })),
  );
}

/**
 * The vault's topic chats, titled as the Topics list names them, for search to find. The other
 * chats under a topic keep their own titles.
 */
export function selectTopicThreads<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly title: string;
  },
>(threads: ReadonlyArray<T>, vault: MajordomeVault | null): ReadonlyArray<T> {
  if (vault === null) return [];
  const titleByThreadKey = new Map(
    vault.topics.flatMap((topic) => [
      ...(topic.threadId === null
        ? []
        : [
            [
              scopedThreadKey({
                environmentId: topic.threadEnvironmentId,
                threadId: topic.threadId,
              }),
              topic.title,
            ] as const,
          ]),
      ...(topic.otherChats ?? []).map((chat) => [scopedThreadKey(chat), topic.title] as const),
    ]),
  );
  const sideKeys = new Set(
    vault.topics.flatMap((topic) => (topic.sideChats ?? []).map((chat) => scopedThreadKey(chat))),
  );
  return threads.flatMap((thread) => {
    const key = scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });
    const title = titleByThreadKey.get(key);
    if (title !== undefined) return [{ ...thread, title }];
    return sideKeys.has(key) ? [thread] : [];
  });
}

/** The line under a topic: its latest message, or its folder until it has one. */
export function topicSubtitle(
  topic: Pick<MajordomeTopic, "folder" | "lastMessagePreview">,
): string {
  const preview = topic.lastMessagePreview;
  if (preview == null) return `Notes in ${topic.folder}`;
  return preview.author === "you" ? `You: ${preview.text}` : preview.text;
}

/**
 * Changes when one of these conversations gets a new message from the owner or a finished reply,
 * so what the servers hold is read again then and only then.
 */
export function topicPreviewStamp(
  threads: ReadonlyArray<
    Pick<EnvironmentThreadShell, "latestUserMessageAt" | "latestRun"> | undefined
  >,
): string {
  return threads
    .map((thread) =>
      thread === undefined
        ? ""
        : `${thread.latestUserMessageAt ?? ""}/${thread.latestRun?.completedAt ?? ""}`,
    )
    .join(",");
}

export type TopicFolderMode = "new" | "existing";

/**
 * What the folder part of the new-topic dialog shows. Each choice the owner has not made (null)
 * follows the server's suggestion for this very name, and until one is there, the fixed place
 * `<projects folder>/<name>`. Once the owner chooses anything, the suggestion is left alone.
 */
export function topicFolderFields(input: {
  readonly title: string;
  readonly projectsFolder: string;
  readonly folders: ReadonlyArray<string>;
  readonly mode: TopicFolderMode | null;
  readonly newFolder: string | null;
  readonly existingFolder: string | null;
  /** The latest answer and the name it was asked for. */
  readonly suggestion: (MajordomeSuggestTopicFolderResult & { readonly title: string }) | null;
}): {
  readonly mode: TopicFolderMode;
  readonly newFolder: string;
  readonly existingFolder: string | null;
  /** The fields show a suggestion that differs from the fixed place. */
  readonly suggested: boolean;
} {
  const fixed = defaultTopicFolder(input.projectsFolder, input.title);
  const untouched =
    input.mode === null && input.newFolder === null && input.existingFolder === null;
  const suggestion =
    untouched && input.suggestion?.title === input.title.trim() ? input.suggestion : null;
  // A folder this window has not listed yet cannot be picked from the list, only typed.
  const existing = suggestion?.existing === true && input.folders.includes(suggestion.folder);
  return {
    mode: input.mode ?? (existing ? "existing" : "new"),
    newFolder: input.newFolder ?? (suggestion !== null && !existing ? suggestion.folder : fixed),
    existingFolder: input.existingFolder ?? (existing && suggestion ? suggestion.folder : null),
    suggested: suggestion !== null && (existing || suggestion.folder !== fixed),
  };
}

/** The topic ids with `topicId` moved by `offset` places, kept within the list. */
export function moveTopic(
  ids: ReadonlyArray<string>,
  topicId: string,
  offset: number,
): ReadonlyArray<string> {
  const from = ids.indexOf(topicId);
  if (from === -1) return ids;
  const to = Math.max(0, Math.min(ids.length - 1, from + offset));
  if (to === from) return ids;
  const next = ids.filter((id) => id !== topicId);
  next.splice(to, 0, topicId);
  return next;
}

/** Folders matching what the owner typed, in their listed order. */
/** Each folder right under its parent, so the list reads as a tree; a search lists the matches. */
export function filterTopicFolders(
  folders: ReadonlyArray<string>,
  query: string,
): ReadonlyArray<string> {
  const wanted = query.trim().toLowerCase();
  const shown =
    wanted === "" ? folders : folders.filter((folder) => folder.toLowerCase().includes(wanted));
  // Segment by segment, so "a/b" follows "a" and not "a-z".
  return shown.toSorted((a, b) => {
    const left = a.split("/");
    const right = b.split("/");
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const order = left[index]!.localeCompare(right[index]!);
      if (order !== 0) return order;
    }
    return left.length - right.length;
  });
}

/**
 * How a folder shows in the tree `filterTopicFolders` orders: under how many listed folders it
 * sits, and its name from the nearest one down. A parent that is not listed stays in the name.
 */
export function topicFolderRow(
  folder: string,
  listed: ReadonlySet<string>,
): { readonly depth: number; readonly name: string } {
  const parts = folder.split("/");
  let depth = 0;
  let from = 0;
  for (let index = 1; index < parts.length; index += 1) {
    if (!listed.has(parts.slice(0, index).join("/"))) continue;
    depth += 1;
    from = index;
  }
  return { depth, name: parts.slice(from).join("/") };
}

/** The topic ids with `topicId` dropped in `targetId`'s place, for drag and drop. */
export function placeTopic(
  ids: ReadonlyArray<string>,
  topicId: string,
  targetId: string,
): ReadonlyArray<string> {
  const target = ids.indexOf(targetId);
  if (target === -1 || topicId === targetId) return ids;
  return moveTopic(ids, topicId, target - ids.indexOf(topicId));
}

/**
 * Every topic id with the listed ones put in `shown`'s order, in the places listed topics held.
 * Finished topics are not listed, so they keep their place in what is saved.
 */
export function orderWithFinished(
  ids: ReadonlyArray<string>,
  shown: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const known = new Set(ids);
  const order = shown.filter((id) => known.has(id));
  const listed = new Set(order);
  let next = 0;
  return ids.map((id) => (listed.has(id) ? order[next++]! : id));
}

/**
 * What follows "Notes in <folder>" under a topic's name in its chat: how many notes the folder
 * holds, when a server says, and when the chat last moved, each led by a middle dot.
 */
export function topicHeaderFacts(
  topic: Pick<MajordomeTopic, "notesCount">,
  lastActivity: string | null,
): string {
  const count = topic.notesCount;
  const notes =
    count === undefined
      ? null
      : count === 0
        ? "no notes yet"
        : `${count} ${count === 1 ? "note" : "notes"}`;
  return [notes, lastActivity]
    .flatMap((part) => (part === null || part === "" ? [] : [` · ${part}`]))
    .join("");
}
