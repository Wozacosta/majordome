import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type MajordomeNotesSearchResult,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as MajordomeNotesSearch from "../../../majordome/MajordomeNotesSearch.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as NotesSearchHandlers from "./handlers.ts";
import { NotesSearchToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:notes");
const ready = { state: "ready", noteCount: 2, lastIndexedAt: "2026-11-16T09:00:00.000Z" } as const;

it.effect("searches the calling thread's notes and answers with paths, titles and snippets", () =>
  Effect.gen(function* () {
    const asked: Array<unknown> = [];
    let next: MajordomeNotesSearchResult = {
      results: [
        {
          path: "trips/lisbon.md",
          title: "Lisbon, March",
          heading: "Hotel",
          snippet: "Hotel: still to pick",
          highlights: [{ start: 0, end: 5 }],
          modifiedAt: "2026-11-15T08:00:00.000Z",
        },
        {
          path: "inbox/hotel.md",
          title: "hotel",
          heading: "hotel",
          snippet: "Ask Ana which hotel she liked",
          highlights: [],
          modifiedAt: "2026-11-14T08:00:00.000Z",
        },
      ],
      status: ready,
    };
    const layerDependencies = Layer.mergeAll(
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment:home"),
        requestNamespace: "provider:notes",
        thread: {
          threadId,
          providerSessionId: "provider:notes",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
      }),
      Layer.mock(MajordomeNotesSearch.MajordomeNotesSearch)({
        searchForThread: (input) => {
          asked.push(input);
          return Effect.succeed(next);
        },
      }),
    );
    yield* Effect.gen(function* () {
      const toolkit = yield* NotesSearchToolkit;
      const search = (params: Parameters<typeof toolkit.handle<"search_notes">>[1]) =>
        toolkit.handle("search_notes", params).pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((parts) => parts.at(-1)?.result),
        );

      // Highlight offsets and dates are for the owner's screen; a heading that repeats the title says nothing.
      expect(yield* search({ query: "hotel", folder: "trips" })).toEqual({
        results: [
          {
            path: "trips/lisbon.md",
            title: "Lisbon, March",
            heading: "Hotel",
            snippet: "Hotel: still to pick",
          },
          { path: "inbox/hotel.md", title: "hotel", snippet: "Ask Ana which hotel she liked" },
        ],
      });
      expect(asked).toEqual([{ threadId, query: "hotel", folder: "trips", limit: 8 }]);

      next = { results: [], status: ready };
      expect(yield* search({ query: "zebra", limit: 3 })).toEqual({
        results: [],
        note: NotesSearchHandlers.SEARCH_NOTES_NOTES.no_match,
      });
      expect(asked.at(-1)).toMatchObject({ limit: 3 });

      next = { results: [], status: { state: "building", noteCount: 0, lastIndexedAt: null } };
      expect(yield* search({ query: "zebra" })).toMatchObject({
        note: NotesSearchHandlers.SEARCH_NOTES_NOTES.building,
      });

      next = { results: [], status: { ...ready, state: "error", reason: "It broke." } };
      expect(yield* search({ query: "zebra" })).toMatchObject({
        note: NotesSearchHandlers.SEARCH_NOTES_NOTES.error,
      });

      next = { results: [], status: null };
      expect(yield* search({ query: "zebra" })).toMatchObject({
        note: NotesSearchHandlers.SEARCH_NOTES_NOTES.not_a_vault,
      });
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(NotesSearchHandlers.layer).pipe(
          Layer.provideMerge(layerDependencies),
        ),
      ),
    );
  }),
);
