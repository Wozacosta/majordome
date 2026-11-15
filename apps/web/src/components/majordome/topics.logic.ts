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

export interface MajordomeVault {
  /** `scopedProjectKey` of the vault's project. */
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly topics: ReadonlyArray<MajordomeTopic>;
  readonly suggestions: ReadonlyArray<MajordomeTopicSuggestion>;
  readonly folders: ReadonlyArray<string>;
  readonly projectsFolder: string;
}

interface ListedProject {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly title: string;
}

/**
 * The vaults among the projects, from each project's topic list (null while it loads). Projects
 * that are not vaults are left out: Majordome shows only vaults.
 */
export function collectVaults(
  projects: ReadonlyArray<ListedProject>,
  results: ReadonlyArray<MajordomeTopicsResult | null | undefined>,
): { readonly vaults: ReadonlyArray<MajordomeVault>; readonly loading: boolean } {
  const vaults: Array<MajordomeVault> = [];
  let loading = false;
  projects.forEach((project, index) => {
    const result = results[index];
    if (result == null) {
      loading = true;
      return;
    }
    if (!result.isVault) return;
    vaults.push({
      key: scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }),
      environmentId: project.environmentId,
      projectId: project.id,
      title: project.title,
      topics: result.topics,
      suggestions: result.suggestions,
      folders: result.folders,
      projectsFolder: result.projectsFolder,
    });
  });
  return { vaults, loading };
}

/** The vault the switcher points at, else the first one. */
export function pickActiveVault(
  vaults: ReadonlyArray<MajordomeVault>,
  chosenKey: string | null,
): MajordomeVault | null {
  return vaults.find((vault) => vault.key === chosenKey) ?? vaults[0] ?? null;
}

/** `scopedThreadKey`s of every topic's thread, in every vault. */
export function topicThreadKeys(vaults: ReadonlyArray<MajordomeVault>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const vault of vaults) {
    for (const topic of vault.topics) {
      if (topic.threadId !== null) {
        keys.add(scopedThreadKey({ environmentId: vault.environmentId, threadId: topic.threadId }));
      }
    }
  }
  return keys;
}

/**
 * Recent: the active vault's one-off chats. Topic threads have their own list, and threads of
 * projects that are not vaults are not shown at all. Nothing while no vault is known yet.
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
      thread.environmentId === vault.environmentId &&
      thread.projectId === vault.projectId &&
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
  const titleByThreadId = new Map(
    vault.topics.flatMap((topic) =>
      topic.threadId === null ? [] : [[topic.threadId, topic.title] as const],
    ),
  );
  return threads.flatMap((thread) => {
    const title =
      thread.environmentId === vault.environmentId ? titleByThreadId.get(thread.id) : undefined;
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
 * Changes when a topic's conversation gets a new message from the owner or a finished reply, so
 * the previews are read again then and only then.
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
