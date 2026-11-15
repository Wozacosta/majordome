import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectVaults,
  defaultTopicFolder,
  moveTopic,
  pickActiveVault,
  placeTopic,
  selectRecentThreads,
  topicThreadKeys,
} from "./topics.logic";

const env = EnvironmentId.make("env-1");
const brain = { environmentId: env, id: ProjectId.make("brain"), title: "brain" };
const work = { environmentId: env, id: ProjectId.make("work"), title: "work" };
const code = { environmentId: env, id: ProjectId.make("code"), title: "t3code" };

const vaultResult = (topics: ReadonlyArray<{ id: string; threadId: string | null }>) => ({
  isVault: true,
  topics: topics.map((topic) => ({
    id: topic.id,
    title: topic.id,
    folder: `projects/${topic.id}`,
    threadId: topic.threadId === null ? null : ThreadId.make(topic.threadId),
    folderExists: true,
    keyNote: null,
  })),
  suggestions: [],
  folders: [],
  projectsFolder: "projects",
});
const notAVault = { ...vaultResult([]), isVault: false };

const thread = (id: string, projectId: ProjectId) => ({
  environmentId: env,
  id: ThreadId.make(id),
  projectId,
});

describe("collectVaults", () => {
  it("keeps only vaults and says when some projects are still loading", () => {
    const { vaults, loading } = collectVaults(
      [brain, code, work],
      [vaultResult([]), notAVault, null],
    );
    expect(vaults.map((vault) => vault.title)).toEqual(["brain"]);
    expect(loading).toBe(true);
  });

  it("shows the chosen vault, or the first when the choice is gone", () => {
    const { vaults } = collectVaults([brain, work], [vaultResult([]), vaultResult([])]);
    expect(pickActiveVault(vaults, vaults[1]!.key)?.title).toBe("work");
    expect(pickActiveVault(vaults, "env-1:gone")?.title).toBe("brain");
    expect(pickActiveVault([], null)).toBeNull();
  });
});

describe("selectRecentThreads", () => {
  const { vaults } = collectVaults(
    [brain, work, code],
    [
      vaultResult([
        { id: "fitness", threadId: "topic-thread" },
        { id: "unopened", threadId: null },
      ]),
      vaultResult([]),
      notAVault,
    ],
  );
  const threads = [
    thread("topic-thread", brain.id),
    thread("one-off", brain.id),
    thread("work-chat", work.id),
    thread("coding", code.id),
  ];

  it("lists the shown vault's one-off chats: never topics, other vaults or other projects", () => {
    const recent = selectRecentThreads(threads, {
      vault: vaults[0]!,
      topicKeys: topicThreadKeys(vaults),
    });
    expect(recent.map((candidate) => candidate.id)).toEqual(["one-off"]);
    const other = selectRecentThreads(threads, {
      vault: vaults[1]!,
      topicKeys: topicThreadKeys(vaults),
    });
    expect(other.map((candidate) => candidate.id)).toEqual(["work-chat"]);
  });

  it("lists nothing until a vault is known", () => {
    expect(selectRecentThreads(threads, { vault: null, topicKeys: new Set() })).toEqual([]);
  });
});

describe("topic order and folders", () => {
  it("moves a topic up, down or onto another one, staying in the list", () => {
    const ids = ["a", "b", "c", "d"];
    expect(moveTopic(ids, "c", -1)).toEqual(["a", "c", "b", "d"]);
    expect(moveTopic(ids, "a", -1)).toBe(ids);
    expect(moveTopic(ids, "d", 5)).toBe(ids);
    expect(placeTopic(ids, "d", "a")).toEqual(["d", "a", "b", "c"]);
    expect(placeTopic(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("puts a new topic's folder in the projects folder, named after the topic", () => {
    expect(defaultTopicFolder("projects", "Moving to Lisbon")).toBe("projects/moving-to-lisbon");
    expect(defaultTopicFolder("1. Projects/", "Café")).toBe("1. Projects/cafe");
    expect(defaultTopicFolder("projects", "")).toBe("projects");
  });
});
