import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { localIsoDate, MEMORY_CHAR_LIMIT, readVaultContext } from "./vaultContext.ts";

// Noon in the server's own time zone, so today and yesterday are unambiguous wherever tests run.
const NOW = DateTime.toEpochMillis(
  DateTime.makeZonedUnsafe("2026-11-15T12:00:00", {
    timeZone: DateTime.zoneMakeLocal(),
    adjustForTimeZone: true,
  }),
);

const makeVault = Effect.fn("test.makeVault")(function* (files: Record<string, string>) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-vault-" });
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = `${root}/${relativePath}`;
    yield* fs.makeDirectory(filePath.slice(0, filePath.lastIndexOf("/")), { recursive: true });
    yield* fs.writeFileString(filePath, contents);
  }
  return root;
});

it.layer(NodeServices.layer)("readVaultContext", (it) => {
  it.effect("loads nothing from a folder that is not a vault", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({ "memory.md": "- Likes tea" });
      assert.equal(yield* readVaultContext({ vaultRoot: root, nowMillis: NOW }), "");
    }),
  );

  it.effect("loads memory and today's and yesterday's daily notes", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({
        ".majordome/config.json": "{}",
        "memory.md": "- Likes tea",
        "daily/2026-11-15.md": "- [ ] Call the bank",
        "daily/2026-11-14.md": "- Met Ana",
        "daily/2026-11-13.md": "- Too old to load",
      });
      const context = yield* readVaultContext({ vaultRoot: root, nowMillis: NOW });
      assert.include(context, '<memory path="memory.md">\n- Likes tea\n</memory>');
      assert.include(context, '<daily_note day="today" date="2026-11-15"');
      assert.include(context, "- [ ] Call the bank");
      assert.include(context, '<daily_note day="yesterday" date="2026-11-14"');
      assert.notInclude(context, "Too old to load");
      assert.isTrue(context.startsWith("<vault_context>"));
    }),
  );

  it.effect("follows the folder names in the vault config", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({
        ".majordome/config.json": JSON.stringify({
          memory: "brain/memory.md",
          folders: { daily: "journal" },
        }),
        "brain/memory.md": "- Prefers checklists",
        "journal/2026-11-15.md": "- Gym",
      });
      const context = yield* readVaultContext({ vaultRoot: root, nowMillis: NOW });
      assert.include(context, '<memory path="brain/memory.md">');
      assert.include(context, 'path="journal/2026-11-15.md"');
    }),
  );

  it.effect("uses defaults when the config is not valid JSON", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({
        ".majordome/config.json": "{ not json",
        "memory.md": "- Likes tea",
      });
      assert.include(yield* readVaultContext({ vaultRoot: root, nowMillis: NOW }), "- Likes tea");
    }),
  );

  it.effect("truncates a long memory file", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({
        ".majordome/config.json": "{}",
        "memory.md": "x".repeat(MEMORY_CHAR_LIMIT + 50),
      });
      const context = yield* readVaultContext({ vaultRoot: root, nowMillis: NOW });
      assert.include(
        context,
        `[Truncated: the note is longer than ${MEMORY_CHAR_LIMIT} characters.]`,
      );
      assert.notInclude(context, "x".repeat(MEMORY_CHAR_LIMIT + 1));
    }),
  );

  it.effect("adds the topic's folder in the thread that holds a topic, and only there", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({
        ".majordome/config.json": "{}",
        ".majordome/topics.json": JSON.stringify({
          topics: [{ id: "fitness", title: "Fitness", folder: "personal/fitness" }],
        }),
        "personal/fitness/log.md": "- Ran 5k",
      });
      const stateDir = yield* makeVault({
        "majordome/topics.json": JSON.stringify({
          projects: { "vault-project": { threads: { fitness: "thread-fitness" } } },
        }),
      });
      const inTopic = yield* readVaultContext({
        vaultRoot: root,
        nowMillis: NOW,
        topicOf: { threadId: "thread-fitness", stateDir },
      });
      assert.isTrue(inTopic.startsWith("<vault_context>"));
      assert.include(inTopic, '<topic title="Fitness" folder="personal/fitness">');
      assert.include(inTopic, "keep its running log in personal/fitness/log.md");
      assert.include(inTopic, "- Ran 5k");
      const elsewhere = yield* readVaultContext({
        vaultRoot: root,
        nowMillis: NOW,
        topicOf: { threadId: "thread-other", stateDir },
      });
      assert.equal(elsewhere, "");
    }),
  );

  it.effect("returns nothing for an empty vault", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({ ".majordome/config.json": "{}" });
      assert.equal(yield* readVaultContext({ vaultRoot: root, nowMillis: NOW }), "");
    }),
  );
});

it("names days in the given time zone", () => {
  const lateEvening = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-15T23:30:00Z"));
  assert.equal(localIsoDate(lateEvening, DateTime.zoneMakeOffset(0)), "2026-11-15");
  assert.equal(localIsoDate(lateEvening, DateTime.zoneMakeOffset(60 * 60 * 1000)), "2026-11-16");
});
