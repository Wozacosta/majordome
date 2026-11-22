import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type MajordomeReadingItem,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as MajordomeReadingList from "../../../majordome/MajordomeReadingList.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as ReadingListHandlers from "./handlers.ts";
import { ReadingListToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:reading");
const projectId = liveThreadShell(threadId).projectId;

const item = (id: string, fields: Partial<MajordomeReadingItem> = {}): MajordomeReadingItem => ({
  id,
  url: `https://example.com/${id}`,
  title: `Title ${id}`,
  kind: "article",
  tags: [],
  addedAt: "2026-11-01T08:00:00.000Z",
  ...fields,
});

it.effect("reads, saves to and changes the calling thread's reading list", () =>
  Effect.gen(function* () {
    let isVault = true;
    let items: ReadonlyArray<MajordomeReadingItem> = [
      item("next", { tags: ["rust"], image: "https://example.com/next.jpg" }),
      item("read", { doneAt: "2026-11-02T08:00:00.000Z", notes: "Good on lifetimes." }),
      item("binned", { deletedAt: "2026-11-03T08:00:00.000Z" }),
      item("other", { site: "Rust Blog", subjectId: "sub-rust" }),
    ];
    const subjects = [{ id: "sub-rust", name: "Rust", focus: true }];
    const calls: Array<readonly [string, unknown]> = [];
    const layerDependencies = Layer.mergeAll(
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment:home"),
        requestNamespace: "provider:reading",
        thread: {
          threadId,
          providerSessionId: "provider:reading",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
      }),
      Layer.mock(MajordomeReadingList.MajordomeReadingList)({
        list: () => Effect.succeed({ isVault, items, subjects: isVault ? subjects : [] }),
        add: (input, options) => {
          calls.push(["add", { input, options }]);
          return Effect.succeed({
            item: item("new"),
            duplicate: input.text === "https://example.com/next",
          });
        },
        update: (input) => {
          calls.push(["update", input]);
          return Effect.succeed(item(input.itemId, { why: input.why ?? undefined }));
        },
        remove: (input) => Effect.sync(() => void calls.push(["remove", input])),
        restore: (input) => Effect.sync(() => void calls.push(["restore", input])),
        reorder: (input) => Effect.sync(() => void calls.push(["reorder", input])),
      }),
    );
    yield* Effect.gen(function* () {
      const toolkit = yield* ReadingListToolkit;
      const call = <Name extends keyof typeof toolkit.tools>(
        name: Name,
        params: Parameters<typeof toolkit.handle<Name>>[1],
      ) =>
        toolkit.handle(name, params).pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((parts) => parts.at(-1)?.result as Record<string, unknown> | undefined),
        );

      // What is left by default, without the picture or empty fields; the Trash only when asked.
      expect(yield* call("list_reading", {})).toEqual({
        items: [
          {
            id: "next",
            title: "Title next",
            url: "https://example.com/next",
            kind: "article",
            tags: ["rust"],
          },
          {
            id: "other",
            title: "Title other",
            url: "https://example.com/other",
            kind: "article",
            site: "Rust Blog",
            subjectId: "sub-rust",
          },
        ],
        subjects,
      });
      expect(yield* call("list_reading", { subjectId: "sub-rust" })).toMatchObject({
        items: [{ id: "other" }],
      });
      expect(yield* call("list_reading", { query: "RUST blog", limit: 1 })).toMatchObject({
        items: [{ id: "other" }],
      });
      expect(yield* call("list_reading", { limit: 1 })).toMatchObject({ total: 2 });
      expect(yield* call("list_reading", { status: "done" })).toMatchObject({
        items: [{ id: "read", notes: "Good on lifetimes." }],
      });
      expect(yield* call("list_reading", { status: "trash" })).toMatchObject({
        items: [{ id: "binned" }],
      });

      // A link the assistant found must load; what it knows about it is saved after.
      expect(
        yield* call("add_reading", {
          text: "https://example.com/new",
          why: "Next after lifetimes.",
        }),
      ).toMatchObject({ duplicate: false, item: { id: "new", why: "Next after lifetimes." } });
      expect(calls).toEqual([
        [
          "add",
          { input: { projectId, text: "https://example.com/new" }, options: { mustLoad: true } },
        ],
        ["update", { projectId, itemId: "new", why: "Next after lifetimes." }],
      ]);
      calls.length = 0;
      // One already saved is left as the owner has it.
      expect(
        yield* call("add_reading", { text: "https://example.com/next", why: "x" }),
      ).toMatchObject({ duplicate: true });
      expect(calls.map(([name]) => name)).toEqual(["add"]);

      calls.length = 0;
      yield* call("update_reading", {
        updates: [
          { id: "next", trashed: true, progress: "Half way" },
          // Already in the Trash: removing it again would delete it for good.
          { id: "binned", trashed: true },
          { id: "read", trashed: false },
        ],
        order: ["other", "next"],
      });
      expect(calls).toEqual([
        ["update", { projectId, itemId: "next", progress: "Half way" }],
        ["remove", { projectId, itemId: "next" }],
        ["reorder", { projectId, itemIds: ["other", "next"] }],
      ]);
      calls.length = 0;
      yield* call("update_reading", { updates: [{ id: "binned", trashed: false }] });
      expect(calls).toEqual([["restore", { projectId, itemId: "binned" }]]);

      // An id that is not on the list changes nothing, also for the ones sent with it.
      calls.length = 0;
      expect(
        yield* call("update_reading", {
          updates: [
            { id: "next", done: true },
            { id: "nope", done: true },
          ],
        }),
      ).toMatchObject({ message: expect.stringContaining("No item nope") });
      expect(calls).toEqual([]);

      isVault = false;
      items = [];
      expect(yield* call("list_reading", {})).toEqual({
        items: [],
        note: ReadingListHandlers.READING_LIST_NOTES.not_a_vault,
      });
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(ReadingListHandlers.layer).pipe(
          Layer.provideMerge(layerDependencies),
        ),
      ),
    );
  }),
);
