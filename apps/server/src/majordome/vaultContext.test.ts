import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { MEMORY_CHAR_LIMIT } from "./memoryPassPrompt.ts";
import { writeMemoryPassState } from "./memoryPassState.ts";
import { localIsoDate, readVaultContext } from "./vaultContext.ts";

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

  it.effect("cuts a memory file over its limit and says how much was left out", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({
        ".majordome/config.json": "{}",
        "memory.md": "x".repeat(MEMORY_CHAR_LIMIT + 50),
      });
      const context = yield* readVaultContext({ vaultRoot: root, nowMillis: NOW });
      assert.include(
        context,
        "[Memory is cut here: memory.md is 8,050 characters and only the first 8,000 are loaded. Read the file when you need the rest.]",
      );
      assert.notInclude(context, "x".repeat(MEMORY_CHAR_LIMIT + 1));
    }),
  );

  it.effect("gives the memory pass its list of changed notes, and no other session", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({ ".majordome/config.json": "{}", "memory.md": "- Likes tea" });
      const stateDir = yield* makeVault({});
      const projectId = "vault-project";
      yield* writeMemoryPassState(
        { stateDir, projectId },
        {
          head: "abc",
          brief: {
            since: "2026-11-14T02:30:00.000Z",
            preparedAt: DateTime.formatIso(DateTime.makeUnsafe(NOW - 5_000)),
            files: ["daily/2026-11-14.md", "projects/flat/log.md"],
            more: 2,
            memoryChars: 11,
          },
        },
      );
      const contextFor = (scheduledTaskId: string | undefined, nowMillis = NOW) =>
        readVaultContext({
          vaultRoot: root,
          nowMillis,
          startedBy: { projectId, scheduledTaskId, stateDir },
        });

      const pass = yield* contextFor(`majordome:${projectId}:tidy-my-memory`);
      assert.include(
        pass,
        [
          '<memory_pass since="2026-11-14T02:30:00.000Z">',
          "Notes that changed since the last memory pass, newest first:",
          "- daily/2026-11-14.md",
          "- projects/flat/log.md",
          "- …and 2 more",
          "memory.md is 11 characters; its limit is 8,000.",
          "</memory_pass>",
        ].join("\n"),
      );
      assert.notInclude(yield* contextFor(undefined), "<memory_pass");
      assert.notInclude(yield* contextFor(`majordome:${projectId}:start-my-day`), "<memory_pass");
      // "Run now" a day later starts without a list: last night's would be stale.
      assert.notInclude(
        yield* contextFor(`majordome:${projectId}:tidy-my-memory`, NOW + 24 * 60 * 60 * 1000),
        "<memory_pass",
      );
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

  it.effect("tells the owner's conversations how to set up routines, not a routine's own run", () =>
    Effect.gen(function* () {
      const root = yield* makeVault({ ".majordome/config.json": "{}", "memory.md": "- Likes tea" });
      const startedBy = { projectId: "vault", stateDir: root };
      const owned = yield* readVaultContext({
        vaultRoot: root,
        nowMillis: NOW,
        startedBy: { ...startedBy, scheduledTaskId: undefined },
      });
      assert.match(owned, /<\/vault_context>\n\n<routines>\n/);
      assert.include(owned, "wait for a yes");
      assert.match(owned, /Now: 2026-11-15T12:00[+-]\d{2}:\d{2} \(/);
      const scheduled = yield* readVaultContext({
        vaultRoot: root,
        nowMillis: NOW,
        startedBy: { ...startedBy, scheduledTaskId: "majordome:vault:start-my-day" },
      });
      assert.notInclude(scheduled, "<routines>");

      // A vault with no notes to load still gets the guide.
      const empty = yield* makeVault({ ".majordome/config.json": "{}" });
      const guideOnly = yield* readVaultContext({
        vaultRoot: empty,
        nowMillis: NOW,
        startedBy: { ...startedBy, scheduledTaskId: undefined },
      });
      assert.isTrue(guideOnly.startsWith("<routines>"));
      assert.include(guideOnly, "<app>");
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
