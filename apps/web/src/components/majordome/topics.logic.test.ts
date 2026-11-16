import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectVaults,
  defaultTopicFolder,
  mergeVaultCopies,
  moveTopic,
  pickActiveVault,
  placeTopic,
  selectRecentThreads,
  selectTopicThreads,
  topicSubtitle,
  topicThreadKeys,
} from "./topics.logic";

const env = EnvironmentId.make("env-1");
const brain = { environmentId: env, id: ProjectId.make("brain"), title: "brain" };
const work = { environmentId: env, id: ProjectId.make("work"), title: "work" };
const code = { environmentId: env, id: ProjectId.make("code"), title: "t3code" };

const vaultResult = (
  topics: ReadonlyArray<{ id: string; threadId: string | null }>,
  routinesThreadId: string | null = null,
) => ({
  routinesThreadId: routinesThreadId === null ? null : ThreadId.make(routinesThreadId),
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
  title: `Chat ${id}`,
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

  it("gives search the shown vault's topic chats, under their topics' titles", () => {
    expect(selectTopicThreads(threads, vaults[0]!)).toEqual([
      { ...thread("topic-thread", brain.id), title: "fitness" },
    ]);
    expect(selectTopicThreads(threads, vaults[1]!)).toEqual([]);
    expect(selectTopicThreads(threads, null)).toEqual([]);
  });
});

describe("mergeVaultCopies", () => {
  const mac = EnvironmentId.make("mac");
  const vps = EnvironmentId.make("vps");
  const onMac = { ...brain, environmentId: mac, id: ProjectId.make("brain-mac") };
  const onVps = { ...brain, environmentId: vps, id: ProjectId.make("brain-vps") };
  const { vaults: copies, loading } = collectVaults(
    [onVps, onMac, { ...work, environmentId: vps }],
    [
      vaultResult(
        [
          { id: "fitness", threadId: "vps-fitness" },
          { id: "reading", threadId: "vps-reading" },
        ],
        "vps-routines",
      ),
      vaultResult([
        { id: "fitness", threadId: "mac-fitness" },
        { id: "reading", threadId: null },
        { id: "new", threadId: null },
      ]),
      vaultResult([]),
    ],
    ["root", "root", "work-root"],
  );
  const vaults = mergeVaultCopies(copies, mac);
  const at = (environmentId: EnvironmentId, id: string, projectId: ProjectId) => ({
    ...thread(id, projectId),
    environmentId,
  });

  it("shows one entry per brain, the window's own server's copy", () => {
    expect(loading).toBe(false);
    expect(vaults.map((vault) => [vault.title, vault.environmentId])).toEqual([
      ["brain", mac],
      ["work", vps],
    ]);
    expect(pickActiveVault(vaults, null)?.environmentId).toBe(mac);
  });

  it("opens a topic's existing conversation, on whichever server has it", () => {
    expect(
      vaults[0]!.topics.map((topic) => [topic.id, topic.threadEnvironmentId, topic.threadId]),
    ).toEqual([
      ["fitness", mac, "mac-fitness"],
      ["reading", vps, "vps-reading"],
      ["new", mac, null],
    ]);
  });

  it("lists the brain's one-off chats from every server, without any server's topic chats", () => {
    const threads = [
      at(mac, "mac-fitness", onMac.id),
      at(vps, "vps-fitness", onVps.id),
      at(vps, "vps-reading", onVps.id),
      at(mac, "mac-chat", onMac.id),
      at(vps, "routine-run", onVps.id),
      // The conversation behind the Routines screen has its place there.
      at(vps, "vps-routines", onVps.id),
    ];
    const recent = selectRecentThreads(threads, {
      vault: vaults[0]!,
      topicKeys: topicThreadKeys(copies),
    });
    expect(recent.map((candidate) => candidate.id)).toEqual(["mac-chat", "routine-run"]);
    expect(selectTopicThreads(threads, vaults[0]!).map((candidate) => candidate.id)).toEqual([
      "mac-fitness",
      "vps-reading",
    ]);
  });

  it("waits for each copy's brain id before showing it", () => {
    const pending = collectVaults([onMac], [vaultResult([])], [undefined]);
    expect(pending).toEqual({ vaults: [], loading: true });
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

describe("topicSubtitle", () => {
  it("shows the latest message, marking the owner's, and the folder before there is one", () => {
    const topic = { folder: "projects/fitness" };
    const agent = { author: "agent", text: "Logged." } as const;
    const you = { author: "you", text: "5k today" } as const;
    expect(topicSubtitle({ ...topic, lastMessagePreview: agent })).toBe("Logged.");
    expect(topicSubtitle({ ...topic, lastMessagePreview: you })).toBe("You: 5k today");
    expect(topicSubtitle({ ...topic, lastMessagePreview: null })).toBe("projects/fitness");
    expect(topicSubtitle(topic)).toBe("projects/fitness");
  });
});
