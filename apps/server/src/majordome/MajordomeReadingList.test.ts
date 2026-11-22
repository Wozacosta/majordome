import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  type MajordomeReadingItem,
  ProjectId,
  TextGenerationError,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient } from "effect/http";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { type FakeReply, fakeHttp, type SentRequest } from "./fakeHttp.testkit.ts";
import * as MajordomeReadingList from "./MajordomeReadingList.ts";
import * as VaultLock from "./VaultLock.ts";

const vaultProject = ProjectId.make("vault-project");
const codeProject = ProjectId.make("code-project");

const html = (text: string): FakeReply => ({
  bytes: new TextEncoder().encode(text),
  headers: { "content-type": "text/html; charset=utf-8" },
});

const ARTICLE = `<html><head><title>Fallback title</title>
<meta property="og:title" content="How compilers work">
<meta property="og:site_name" content="The Blog">
<meta property="og:image" content="/covers/compilers.jpg"></head>
<body><article>${Array.from({ length: 660 }, () => "word").join(" ")}</article></body></html>`;

const setUp = Effect.fn("test.setUp")(function* (
  handle: (sent: SentRequest) => FakeReply = () => html(ARTICLE),
  /** What the owner's AI answers when asked to describe a link; absent, it is not ready. */
  described?: string,
) {
  const prompts: Array<string> = [];
  const fs = yield* FileSystem.FileSystem;
  const vault = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-reading-vault-" });
  const code = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-reading-code-" });
  yield* fs.makeDirectory(`${vault}/.majordome`);
  yield* fs.writeFileString(`${vault}/.majordome/config.json`, "{}");
  const roots: Record<string, string> = { [vaultProject]: vault, [codeProject]: code };
  const http = fakeHttp(handle);
  const service = yield* Effect.service(MajordomeReadingList.MajordomeReadingList).pipe(
    Effect.provide(
      MajordomeReadingList.layer.pipe(
        Layer.provide(VaultLock.layer),
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: (projectId) =>
              Effect.succeed(
                roots[projectId] === undefined
                  ? Option.none()
                  : Option.some({
                      projectId,
                      workspaceRoot: roots[projectId],
                    } as unknown as ProjectStore.ProjectRow),
              ),
          }),
        ),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, http.client)),
        Layer.provide(
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
          }),
        ),
        Layer.provide(
          Layer.mock(TextGeneration.TextGeneration)({
            generateTranscriptionPostProcessing: (input) => {
              prompts.push(input.prompt);
              return described === undefined
                ? Effect.fail(
                    new TextGenerationError({
                      operation: "generateTranscriptionPostProcessing",
                      detail: "No provider instance registered.",
                    }),
                  )
                : Effect.succeed({ transcription: described });
            },
          }),
        ),
        Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      ),
    ),
  );
  const filePath = `${vault}/.majordome/reading-list.json`;
  const items = service
    .list({ projectId: vaultProject })
    .pipe(Effect.map((result) => result.items));
  const addTitle = (text: string) =>
    service.add({ projectId: vaultProject, text }).pipe(Effect.map((added) => added.item));
  return { service, fs, vault, filePath, items, addTitle, requests: http.requests, prompts };
});

const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const item = (id: string, fields: Partial<MajordomeReadingItem> = {}): MajordomeReadingItem => ({
  id,
  url: null,
  title: id,
  kind: "other",
  tags: [],
  addedAt: "2026-11-01T08:00:00.000Z",
  ...fields,
});

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("MajordomeReadingList", (it) => {
  it.effect("is empty for a project that is not a vault, and for a vault with no list yet", () =>
    Effect.gen(function* () {
      const { service } = yield* setUp();
      assert.deepEqual(yield* service.list({ projectId: codeProject }), {
        isVault: false,
        items: [],
      });
      assert.deepEqual(yield* service.list({ projectId: vaultProject }), {
        isVault: true,
        items: [],
      });
      const refused = yield* Effect.flip(service.add({ projectId: codeProject, text: "A book" }));
      assert.equal(refused.message, "That notes folder was not found.");
    }),
  );

  it.effect("saves a link first in the list, with what its page says about it", () =>
    Effect.gen(function* () {
      const { service, fs, filePath, items, addTitle, requests } = yield* setUp();
      const older = yield* addTitle("An older one");
      yield* TestClock.adjust("1 hour");
      const savedAt = yield* now;
      assert.notEqual(savedAt, older.addedAt);
      const added = yield* service.add({
        projectId: vaultProject,
        text: "https://Blog.example.com/compilers/?utm_source=mail",
      });
      assert.isFalse(added.duplicate);
      assert.deepInclude(added.item, {
        url: "https://blog.example.com/compilers/?utm_source=mail",
        title: "How compilers work",
        site: "The Blog",
        kind: "article",
        minutes: 3,
        image: "https://blog.example.com/covers/compilers.jpg",
        tags: [],
        addedAt: savedAt,
      });
      assert.match(added.item.id, /^itm-[0-9a-f-]{36}$/);
      assert.deepEqual(yield* items, [added.item, older]);
      assert.deepEqual(
        requests.map((sent) => sent.route),
        ["GET blog.example.com/compilers/"],
      );
      // Pretty-printed, since the owner and the assistant read and edit it.
      const text = yield* fs.readFileString(filePath);
      assert.isTrue(text.startsWith('{\n  "items": [\n    {\n      "id": "itm-'));
      assert.deepEqual(
        (yield* fs.readDirectory(filePath.slice(0, filePath.lastIndexOf("/")))).toSorted(),
        ["config.json", "reading-list.json"],
      );

      // The same page under other tracking parameters is already saved: nothing is fetched.
      const again = yield* service.add({
        projectId: vaultProject,
        text: "https://blog.example.com/compilers?utm_campaign=x#top",
      });
      assert.deepEqual(again, { item: added.item, duplicate: true });
      assert.lengthOf(requests, 1);
      assert.lengthOf(yield* items, 2);

      // Looked up again: the owner's title and length stay, and a change beside it keeps the picture.
      yield* service.update({
        projectId: vaultProject,
        itemId: added.item.id,
        title: "Compilers, by me",
        minutes: 7,
      });
      const looked = yield* service.update({
        projectId: vaultProject,
        itemId: added.item.id,
        lookUp: true,
      });
      assert.lengthOf(requests, 2);
      assert.deepInclude(looked, {
        title: "Compilers, by me",
        minutes: 7,
        image: "https://blog.example.com/covers/compilers.jpg",
      });
      // Something saved by its title has nothing to look up.
      yield* service.update({ projectId: vaultProject, itemId: older.id, lookUp: true });
      assert.lengthOf(requests, 2);
    }),
  );

  it.effect("saves a link whose page cannot be read, named after its address", () =>
    Effect.gen(function* () {
      const { service, requests } = yield* setUp((sent) =>
        sent.url.host === "www.youtube.com"
          ? { body: { title: "A talk", author_name: "The Channel" } }
          : { status: 500 },
      );
      const failed = yield* service.add({
        projectId: vaultProject,
        text: "www.example.com/blog/a-post",
      });
      assert.deepInclude(failed.item, {
        url: "https://www.example.com/blog/a-post",
        title: "example.com/blog/a-post",
        site: "example.com",
        kind: "article",
      });
      assert.notProperty(failed.item, "minutes");

      // A private address is saved without the server ever asking for it.
      const asked = requests.length;
      const local = yield* service.add({ projectId: vaultProject, text: "http://192.168.1.1/x" });
      assert.deepInclude(local.item, { title: "192.168.1.1/x", site: "192.168.1.1" });
      assert.lengthOf(requests, asked);

      const video = yield* service.add({
        projectId: vaultProject,
        text: "https://youtu.be/abc123",
      });
      assert.deepInclude(video.item, { title: "A talk", site: "The Channel", kind: "video" });
      assert.notProperty(video.item, "minutes");
      assert.equal(
        requests
          .find((sent) => sent.route === "GET www.youtube.com/oembed")
          ?.url.searchParams.get("url"),
        "https://youtu.be/abc123",
      );
    }),
  );

  it.effect("finds how long a video plays, at once or when looked up again", () =>
    Effect.gen(function* () {
      let watchPageUp = false;
      // The real page says its length some 0.9 MB in: past the cap other pages are read to.
      const watchPage = `<html><head>${" ".repeat(1_200_000)}
        <meta itemprop="duration" content="PT1H56M12S"></head><body></body></html>`;
      const { service } = yield* setUp((sent) =>
        sent.route === "GET www.youtube.com/oembed"
          ? { body: { title: "A long talk", author_name: "The Channel" } }
          : sent.route === "GET www.youtube.com/watch"
            ? watchPageUp
              ? html(watchPage)
              : { status: 429 }
            : html(
                `<head><title>A lecture</title><meta property="og:video:duration" content="754"></head>`,
              ),
      );
      const add = (text: string) =>
        service.add({ projectId: vaultProject, text }).pipe(Effect.map((added) => added.item));

      // Without its watch page a video is still saved, by what oEmbed says, with no length.
      const video = yield* add("https://www.youtube.com/watch?v=abc123");
      assert.deepInclude(video, { title: "A long talk", site: "The Channel", kind: "video" });
      assert.notProperty(video, "minutes");
      watchPageUp = true;
      const looked = yield* service.update({
        projectId: vaultProject,
        itemId: video.id,
        lookUp: true,
      });
      assert.equal(looked.minutes, 116);
      assert.equal((yield* add("https://www.youtube.com/watch?v=other")).minutes, 116);

      // Any other video page: the length it gives for sharing, in seconds.
      assert.deepInclude(yield* add("https://vimeo.com/123"), { kind: "video", minutes: 13 });

      // A page saved as an article has no playing time until the owner says it is a video,
      // and changing the kind alone leaves the length as it is.
      const lecture = yield* add("https://school.example/lecture");
      assert.notProperty(lecture, "minutes");
      const asVideo = yield* service.update({
        projectId: vaultProject,
        itemId: lecture.id,
        kind: "video",
        lookUp: true,
      });
      assert.deepInclude(asVideo, { kind: "video", minutes: 13 });
      const asPodcast = yield* service.update({
        projectId: vaultProject,
        itemId: lecture.id,
        kind: "podcast",
      });
      assert.deepInclude(asPodcast, { kind: "podcast", minutes: 13 });
    }),
  );

  it.effect("has the owner's AI tag and sum up a link, keeping what is already there", () =>
    Effect.gen(function* () {
      const { service, prompts } = yield* setUp(
        () => html(ARTICLE),
        "tags: Compilers, parsing || summary: How source code becomes a program.",
      );
      const tagged = yield* service.add({ projectId: vaultProject, text: "https://a.example/one" });
      yield* service.update({ projectId: vaultProject, itemId: tagged.item.id, tags: ["mine"] });
      const kept = yield* service.update({
        projectId: vaultProject,
        itemId: tagged.item.id,
        enrich: true,
      });
      // The owner's tags stay; the summary it lacked is filled in.
      assert.deepEqual(kept.tags, ["mine"]);
      assert.equal(kept.summary, "How source code becomes a program.");

      const bare = yield* service.add({ projectId: vaultProject, text: "https://a.example/two" });
      const filled = yield* service.update({
        projectId: vaultProject,
        itemId: bare.item.id,
        enrich: true,
      });
      assert.deepEqual(filled.tags, ["compilers", "parsing"]);
      // It is asked with the page's words and the tags already in use.
      assert.include(prompts.at(-1), "title: How compilers work");
      assert.include(prompts.at(-1), "word word word");
      assert.include(prompts.at(-1), "mine");
    }),
  );

  it.effect("leaves a link as it is when the owner's AI is not ready", () =>
    Effect.gen(function* () {
      const { service, prompts } = yield* setUp();
      const added = yield* service.add({ projectId: vaultProject, text: "https://a.example/one" });
      const same = yield* service.update({
        projectId: vaultProject,
        itemId: added.item.id,
        enrich: true,
      });
      assert.lengthOf(prompts, 1);
      assert.deepEqual(same, added.item);
    }),
  );

  it.effect("saves a plain title as something without a link", () =>
    Effect.gen(function* () {
      const { service, requests } = yield* setUp();
      const added = yield* service.add({ projectId: vaultProject, text: "Thinking in Systems" });
      assert.isFalse(added.duplicate);
      assert.deepInclude(added.item, {
        url: null,
        title: "Thinking in Systems",
        kind: "other",
        tags: [],
      });
      assert.notProperty(added.item, "site");
      assert.lengthOf(requests, 0);
    }),
  );

  it.effect("changes only the fields sent, and dates what is finished", () =>
    Effect.gen(function* () {
      const { service, items, addTitle } = yield* setUp();
      const added = yield* addTitle("A book");
      const change = (fields: Record<string, unknown>) =>
        service.update({ projectId: vaultProject, itemId: added.id, ...fields });

      yield* TestClock.adjust("2 hours");
      const finishedAt = yield* now;
      const edited = yield* change({
        title: "A better title",
        kind: "paper",
        tags: [" Rust ", "rust", "", "Compilers"],
        minutes: 12,
        starred: true,
        notes: "Worth a second read.",
        done: true,
      });
      assert.deepEqual(edited, {
        ...added,
        title: "A better title",
        kind: "paper",
        tags: ["rust", "compilers"],
        minutes: 12,
        doneAt: finishedAt,
        starred: true,
        notes: "Worth a second read.",
      });
      assert.deepEqual(yield* items, [edited]);

      // A field left out stays; finishing it again keeps the day it was first finished.
      yield* TestClock.adjust("1 hour");
      assert.deepEqual(yield* change({ done: true, tags: ["rust"] }), {
        ...edited,
        tags: ["rust"],
      });

      const cleared = yield* change({ done: false, minutes: null, notes: "  ", starred: false });
      assert.deepEqual(cleared, {
        ...added,
        title: "A better title",
        kind: "paper",
        tags: ["rust"],
      });
      assert.notProperty(
        yield* change({ notes: "x" }).pipe(Effect.andThen(change({ notes: null }))),
        "notes",
      );

      yield* service.remove({ projectId: vaultProject, itemId: added.id });
      const gone = yield* Effect.flip(change({ title: "Too late" }));
      assert.equal(gone.message, "That item is no longer on your list.");
    }),
  );

  it.effect("snoozes an item until a day, through other changes, until woken or finished", () =>
    Effect.gen(function* () {
      const { service, items, addTitle } = yield* setUp();
      const added = yield* addTitle("A book");
      const change = (fields: Record<string, unknown>) =>
        service.update({ projectId: vaultProject, itemId: added.id, ...fields });

      const snoozed = yield* change({ snoozedUntil: "2026-12-02" });
      assert.deepEqual(snoozed, { ...added, snoozedUntil: "2026-12-02" });
      assert.deepEqual(yield* items, [snoozed]);
      assert.equal((yield* change({ starred: true, tags: ["rust"] })).snoozedUntil, "2026-12-02");

      assert.notProperty(yield* change({ snoozedUntil: null }), "snoozedUntil");

      // Finishing it ends the snooze, also when both arrive together, and it stays ended.
      yield* change({ snoozedUntil: "2026-12-09" });
      const finished = yield* change({ done: true });
      assert.property(finished, "doneAt");
      assert.notProperty(finished, "snoozedUntil");
      assert.notProperty(yield* change({ done: false }), "snoozedUntil");
      assert.notProperty(yield* change({ done: true, snoozedUntil: "2026-12-09" }), "snoozedUntil");

      for (const notADay of ["tomorrow", "2026-02-30", "2026-12-02T08:00:00.000Z", ""]) {
        const refused = yield* Effect.flip(change({ done: false, snoozedUntil: notADay }));
        assert.equal(refused.message, "That is not a day this can be snoozed until.", notADay);
      }
      assert.property((yield* items)[0], "doneAt");
    }),
  );

  it.effect("reorders, removes and puts back where it was", () =>
    Effect.gen(function* () {
      const { service, fs, filePath, items } = yield* setUp();
      const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => item(id)) as [
        MajordomeReadingItem,
        MajordomeReadingItem,
        MajordomeReadingItem,
        MajordomeReadingItem,
      ];
      yield* fs.writeFileString(filePath, JSON.stringify({ items: [a, b, c, d] }));
      const ids = items.pipe(Effect.map((list) => list.map((entry) => entry.id)));

      // Ids left out keep their order at the end; one that is not on the list is ignored.
      yield* service.reorder({ projectId: vaultProject, itemIds: ["c", "missing", "a"] });
      assert.deepEqual(yield* ids, ["c", "a", "b", "d"]);

      yield* service.remove({ projectId: vaultProject, itemId: "a" });
      yield* service.remove({ projectId: vaultProject, itemId: "a" });
      assert.deepEqual(yield* ids, ["c", "b", "d"]);

      yield* service.restore({ projectId: vaultProject, item: a, index: 1 });
      assert.deepEqual(yield* items, [c, a, b, d]);
      // Already back: a second undo adds no copy.
      yield* service.restore({ projectId: vaultProject, item: a, index: 0 });
      assert.deepEqual(yield* ids, ["c", "a", "b", "d"]);

      yield* service.remove({ projectId: vaultProject, itemId: "d" });
      yield* service.restore({ projectId: vaultProject, item: d, index: 99 });
      yield* service.remove({ projectId: vaultProject, itemId: "c" });
      yield* service.restore({ projectId: vaultProject, item: c, index: -3 });
      assert.deepEqual(yield* ids, ["c", "a", "b", "d"]);
    }),
  );

  it.effect("lists the good items of a hand-edited file, and never deletes the rest", () =>
    Effect.gen(function* () {
      const { service, fs, filePath, items, addTitle } = yield* setUp();
      const good = item("good", { url: "https://example.com/a", site: "example.com" });
      const broken = { id: "broken", title: "No kind, no tags" };
      yield* fs.writeFileString(
        filePath,
        JSON.stringify({ items: [broken, good, "nonsense", item("good", { title: "Twin" })] }),
      );
      assert.deepEqual(yield* items, [good]);

      const added = yield* addTitle("A new one");
      assert.deepEqual(yield* items, [added, good]);
      const kept = JSON.parse(yield* fs.readFileString(filePath)) as {
        items: ReadonlyArray<unknown>;
      };
      assert.deepInclude(kept.items, broken);
      assert.include(kept.items, "nonsense");

      // A file that is not a list at all is left as it is, rather than replaced by a save.
      yield* fs.writeFileString(filePath, '{ "items": [ oops');
      const unreadable = yield* Effect.flip(service.list({ projectId: vaultProject }));
      assert.equal(unreadable.message, "Could not read your reading list.");
      const refused = yield* Effect.flip(service.add({ projectId: vaultProject, text: "Another" }));
      assert.equal(refused.message, "Could not read your reading list.");
      assert.equal(yield* fs.readFileString(filePath), '{ "items": [ oops');
    }),
  );
});
