import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  listVaultFolders,
  newTopicId,
  normalizeTopicFolder,
  parseVaultTopics,
  readTopicContext,
  readVaultTopics,
  reorderVaultTopics,
  serializeVaultTopics,
  suggestTopics,
  TOPIC_CONTEXT_CHAR_LIMIT,
  topicTitleFromFolder,
  writeVaultTopics,
} from "./vaultTopics.ts";

const makeVault = Effect.fn("test.makeVault")(function* (files: Record<string, string>) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-topics-" });
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = `${root}/${relativePath}`;
    yield* fs.makeDirectory(filePath.slice(0, filePath.lastIndexOf("/")), { recursive: true });
    if (!relativePath.endsWith("/")) yield* fs.writeFileString(filePath, contents);
  }
  return root;
});

describe("topics.json", () => {
  it("keeps folders inside the vault", () => {
    assert.equal(normalizeTopicFolder(" ./personal\\fitness/ "), "personal/fitness");
    assert.equal(normalizeTopicFolder("projects//lisbon-move"), "projects/lisbon-move");
    for (const outside of ["", "/", "/etc", "C:/Users", "../elsewhere", "a/../../b", ".git"]) {
      assert.isNull(normalizeTopicFolder(outside), outside);
    }
  });

  it("drops entries that are malformed, repeated or outside the vault, and keeps the order", () => {
    const topics = parseVaultTopics(
      JSON.stringify({
        topics: [
          { id: "fitness", title: "Fitness", folder: "personal/fitness/" },
          { id: "fitness", title: "Again", folder: "personal/other" },
          { id: "escape", title: "Escape", folder: "../outside" },
          { id: "untitled", folder: "x" },
          { id: "lisbon", title: "Lisbon move", folder: "projects/lisbon-move" },
        ],
      }),
    );
    assert.deepEqual(topics, [
      { id: "fitness", title: "Fitness", folder: "personal/fitness" },
      { id: "lisbon", title: "Lisbon move", folder: "projects/lisbon-move" },
    ]);
    assert.deepEqual(parseVaultTopics("{ not json"), []);
    assert.deepEqual(parseVaultTopics("[]"), []);
    assert.deepEqual(parseVaultTopics(serializeVaultTopics(topics)), topics);
  });

  it("reorders by the ids given and keeps the ones left out at the end", () => {
    const topics = ["a", "b", "c", "d"].map((id) => ({ id, title: id, folder: id }));
    assert.deepEqual(
      reorderVaultTopics(topics, ["c", "missing", "a"]).map((topic) => topic.id),
      ["c", "a", "b", "d"],
    );
  });

  it("gives topics readable, unique ids", () => {
    assert.equal(newTopicId("Quitting nicotine!", new Set()), "quitting-nicotine");
    assert.equal(newTopicId("Café crème", new Set(["cafe-creme"])), "cafe-creme-2");
    assert.equal(newTopicId("???", new Set()), "topic");
  });

  it.effect("reads nothing from a vault without topics and writes what it reads back", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({ ".majordome/config.json": "{}" });
      assert.deepEqual(yield* readVaultTopics(root), []);
      const topics = [{ id: "fitness", title: "Fitness", folder: "personal/fitness" }];
      yield* writeVaultTopics({ vaultRoot: root, topics });
      assert.deepEqual(yield* readVaultTopics(root), topics);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("suggestTopics", () => {
  const layout = { dailyFolder: "daily", inboxFolder: "inbox", projectsFolder: "projects" };

  it("names folders the way people do", () => {
    assert.equal(topicTitleFromFolder("projects/lisbon-move"), "Lisbon move");
    assert.equal(topicTitleFromFolder("personal/fitness"), "Fitness");
    assert.equal(topicTitleFromFolder("1. Projects/Tax Return"), "Tax Return");
    assert.equal(topicTitleFromFolder("areas/02_house_works"), "House works");
  });

  it("suggests project and area folders with notes, and skips plumbing and empty folders", () => {
    const folder = (path: string, notes = 1) => ({ path, notes });
    const suggestions = suggestTopics({
      layout,
      taken: new Set(["personal/taxes"]),
      folders: [
        folder("attachments", 3),
        folder("daily", 30),
        folder("inbox", 2),
        folder("personal", 5),
        folder("personal/fitness"),
        folder("personal/taxes"),
        folder("personal/attachments"),
        folder("personal/empty", 0),
        folder("projects", 2),
        folder("projects/lisbon-move"),
        folder("projects/lisbon-move/visas"),
        folder("recipes", 4),
        folder("templates", 2),
        folder("_meta", 1),
        folder("archive", 9),
        folder("archive/old-job"),
      ],
    });
    // With no dates known, the fuller folder comes first.
    assert.deepEqual(suggestions, [
      { title: "Recipes", folder: "recipes" },
      { title: "Fitness", folder: "personal/fitness" },
      { title: "Lisbon move", folder: "projects/lisbon-move" },
    ]);
  });

  it("puts the folders written in most lately first, from any area, and skips code repos", () => {
    const suggestions = suggestTopics({
      layout,
      taken: new Set(),
      folders: [
        { path: "projects/alfandari", notes: 9, newestNoteMs: 1_000 },
        { path: "projects/old-site", notes: 3, newestNoteMs: 2_000, inRepo: true },
        { path: "personal/fitness", notes: 2, newestNoteMs: 9_000 },
        { path: "personal/finances", notes: 4, newestNoteMs: 8_000 },
      ],
    });
    assert.deepEqual(
      suggestions.map((suggestion) => suggestion.folder),
      ["personal/fitness", "personal/finances", "projects/alfandari"],
    );
  });

  it("suggests at most twelve", () => {
    const folders = Array.from({ length: 20 }, (_, index) => ({
      path: `projects/p${index}`,
      notes: 1,
    }));
    assert.lengthOf(suggestTopics({ layout, taken: new Set(), folders }), 12);
  });

  it.effect("lists the vault's folders with their notes, plumbing left out", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({
        ".majordome/config.json": "{}",
        ".obsidian/app.json": "{}",
        "personal/fitness/log.md": "- Ran 5k",
        "personal/fitness/plan.md": "Plan",
        "projects/lisbon-move/visas/d7.md": "D7",
        "inbox/": "",
      });
      const folders = yield* listVaultFolders(root);
      assert.isTrue(folders.every((folder) => folder.inRepo === false));
      assert.isAbove(
        folders.find((folder) => folder.path === "personal/fitness")?.newestNoteMs ?? 0,
        0,
      );
      assert.deepEqual(
        folders.map(({ path, notes }) => ({ path, notes })),
        [
          { path: "inbox", notes: 0 },
          { path: "personal", notes: 2 },
          { path: "projects", notes: 1 },
          { path: "personal/fitness", notes: 2 },
          { path: "projects/lisbon-move", notes: 1 },
          { path: "projects/lisbon-move/visas", notes: 1 },
        ],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("readTopicContext", () => {
  const topic = { id: "fitness", title: "Fitness", folder: "personal/fitness" };

  it.effect("says what the conversation is and loads the log, the readme and the notes list", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({
        "personal/fitness/log.md": "- 2026-11-14: Ran 5k in 28 minutes",
        "personal/fitness/README.md": "# Fitness\n\nGoal: a half marathon in May.",
        "personal/fitness/plans/week-1.md": "Mon: rest",
        "personal/other/unrelated.md": "Not this topic",
      });
      const context = yield* readTopicContext({ vaultRoot: root, topic });
      assert.isTrue(context.startsWith('<topic title="Fitness" folder="personal/fitness">'));
      assert.include(context, 'This conversation is the topic "Fitness"');
      assert.include(context, "personal/fitness/log.md");
      assert.include(context, "Ran 5k in 28 minutes");
      assert.include(context, "Goal: a half marathon in May.");
      assert.include(context, "- plans/week-1.md (changed ");
      assert.notInclude(context, "Not this topic");
      assert.isTrue(context.endsWith("</topic>"));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("stays within its cap and keeps the newest end of a long log", () =>
    Effect.gen(function* () {
      const files: Record<string, string> = {
        "personal/fitness/log.md": `${"- old entry\n".repeat(2_000)}- NEWEST ENTRY`,
        "personal/fitness/README.md": "R".repeat(5_000),
      };
      for (let index = 0; index < 60; index += 1) {
        files[`personal/fitness/notes/note-${index}.md`] = "N".repeat(3_000);
      }
      const root = yield* makeVault(files);
      const context = yield* readTopicContext({ vaultRoot: root, topic });
      assert.isAtMost(context.length, TOPIC_CONTEXT_CHAR_LIMIT);
      assert.include(context, "NEWEST ENTRY");
      assert.include(context, "[…earlier entries left out.]");
      assert.include(context, "- …and 32 more");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("says so when the folder has no notes yet", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({ "personal/fitness/": "" });
      const context = yield* readTopicContext({ vaultRoot: root, topic });
      assert.include(context, "The folder has no notes yet.");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
