import { scopedProjectKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  MajordomeTopic,
  MajordomeTopicSuggestion,
  MajordomeTopicsResult,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

import { groupBrains } from "./brains.logic";

/** A topic with the server its conversation is on. */
export interface VaultTopic extends MajordomeTopic {
  /** The shown copy's server, or another copy's when only that one has the conversation. */
  readonly threadEnvironmentId: EnvironmentId;
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
  readonly folders: ReadonlyArray<string>;
  readonly projectsFolder: string;
  /** Every server's copy of this brain, the shown one first. */
  readonly copies: ReadonlyArray<VaultCopy>;
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
      })),
      suggestions: result.suggestions,
      folders: result.folders,
      projectsFolder: result.projectsFolder,
      copies: [copy],
    });
  });
  return { vaults, loading };
}

/**
 * One vault per brain: the copy on the window's own server when there is one, else the first.
 * Each server keeps its own thread per topic, so a topic this copy has not opened yet goes to the
 * conversation another copy already has, rather than starting a second one.
 */
export function mergeVaultCopies(
  copies: ReadonlyArray<MajordomeVault>,
  primaryEnvironmentId: EnvironmentId | null,
): ReadonlyArray<MajordomeVault> {
  return groupBrains(copies, primaryEnvironmentId).map((brain) => {
    const [shown, ...others] = brain.copies;
    return {
      ...shown,
      key: brain.key,
      copies: brain.copies.flatMap((copy) => copy.copies),
      topics: shown.topics.map((topic) => {
        if (topic.threadId !== null) return topic;
        const elsewhere = others
          .flatMap((other) => other.topics)
          .find((candidate) => candidate.id === topic.id && candidate.threadId !== null);
        return elsewhere === undefined
          ? topic
          : {
              ...topic,
              threadId: elsewhere.threadId,
              threadEnvironmentId: elsewhere.threadEnvironmentId,
              lastMessagePreview: elsewhere.lastMessagePreview,
            };
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
 * `scopedThreadKey`s of every thread that has its own place, in every vault: each topic's, and the
 * conversation behind the Routines screen.
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

/** The vault's topic chats, titled as the Topics list names them, for search to find. */
export function selectTopicThreads<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly title: string;
  },
>(threads: ReadonlyArray<T>, vault: MajordomeVault | null): ReadonlyArray<T> {
  if (vault === null) return [];
  const titleByThreadKey = new Map(
    vault.topics.flatMap((topic) =>
      topic.threadId === null
        ? []
        : [
            [
              scopedThreadKey({
                environmentId: topic.threadEnvironmentId,
                threadId: topic.threadId,
              }),
              topic.title,
            ] as const,
          ],
    ),
  );
  return threads.flatMap((thread) => {
    const title = titleByThreadKey.get(
      scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
    );
    return title === undefined ? [] : [{ ...thread, title }];
  });
}

/** The line under a topic: its latest message, or its folder until it has one. */
export function topicSubtitle(
  topic: Pick<MajordomeTopic, "folder" | "lastMessagePreview">,
): string {
  const preview = topic.lastMessagePreview;
  if (preview == null) return topic.folder;
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

/** Where a new topic's folder goes: `<projects folder>/<title as a folder name>`. */
export function defaultTopicFolder(projectsFolder: string, title: string): string {
  const name = title
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 60);
  const base = projectsFolder.replace(/\/+$/, "");
  if (name === "") return base;
  return base === "" ? name : `${base}/${name}`;
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
export function filterTopicFolders(
  folders: ReadonlyArray<string>,
  query: string,
): ReadonlyArray<string> {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return folders;
  return folders.filter((folder) => folder.toLowerCase().includes(wanted));
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
