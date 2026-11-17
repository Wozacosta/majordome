import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectVaults,
  mergeVaultCopies,
  moveTopic,
  pickActiveVault,
  placeTopic,
  selectRecentThreads,
  selectTopicThreads,
  topicSubtitle,
  topicThreadKeys,
  filterTopicFolders,
  topicFolderFields,
  topicFolderRow,
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
});

describe("topicFolderFields", () => {
  const base = {
    title: "Paying the electricity bill ",
    projectsFolder: "projects",
    folders: ["personal", "personal/finances"],
    mode: null,
    newFolder: null,
    existingFolder: null,
    suggestion: null,
  } as const;
  const fixed = "projects/paying-the-electricity-bill";
  const title = "Paying the electricity bill";
  const created = { title, folder: "personal/finances/electricity", existing: false };
  const found = { title, folder: "personal/finances", existing: true };

  it.each([
    ["the fixed place before any answer", {}, "new", fixed, null, false],
    ["a suggested new folder", { suggestion: created }, "new", created.folder, null, true],
    ["a suggested existing folder", { suggestion: found }, "existing", fixed, found.folder, true],
    [
      "an existing folder this window has not listed, as one to type",
      { suggestion: { ...found, folder: "personal/bills" } },
      "new",
      "personal/bills",
      null,
      true,
    ],
    [
      "nothing new when the answer is the fixed place",
      { suggestion: { title, folder: fixed, existing: false } },
      "new",
      fixed,
      null,
      false,
    ],
    [
      "the fixed place when the answer was for another name",
      { suggestion: { ...found, title: "Paying" } },
      "new",
      fixed,
      null,
      false,
    ],
    [
      "what the owner typed over an answer that came later",
      { newFolder: "bills", suggestion: found },
      "new",
      "bills",
      null,
      false,
    ],
    [
      "the owner's own pick of folder",
      { mode: "existing", existingFolder: "personal", suggestion: created },
      "existing",
      fixed,
      "personal",
      false,
    ],
  ] as const)("shows %s", (_what, change, mode, newFolder, existingFolder, suggested) => {
    expect(topicFolderFields({ ...base, ...change })).toEqual({
      mode,
      newFolder,
      existingFolder,
      suggested,
    });
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

describe("topic folder tree", () => {
  it("lists each folder under its parent and names it from the nearest listed one", () => {
    const folders = ["personal", "personal-old", "projects/app/docs", "personal/fitness"];
    const shown = filterTopicFolders(folders, "");
    expect(shown).toEqual(["personal", "personal/fitness", "personal-old", "projects/app/docs"]);
    const listed = new Set(shown);
    expect(shown.map((folder) => topicFolderRow(folder, listed))).toEqual([
      { depth: 0, name: "personal" },
      { depth: 1, name: "fitness" },
      { depth: 0, name: "personal-old" },
      { depth: 0, name: "projects/app/docs" },
    ]);
    expect(filterTopicFolders(folders, "FIT")).toEqual(["personal/fitness"]);
  });
});
