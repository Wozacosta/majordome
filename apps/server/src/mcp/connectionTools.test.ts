import { assert, it } from "@effect/vitest";
import type { MajordomeConnection } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { McpSchema } from "effect/ai";

import * as MajordomeConnections from "../majordome/connections/MajordomeConnections.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ConnectionTools from "./connectionTools.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";

type Registration = Parameters<ConnectionTools.ToolServer["register"]>[0];

const GRANOLA_TOOLS: ReadonlyArray<MajordomeConnections.AppTool> = [
  {
    name: "list_meetings",
    description: "Lists meetings",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    readOnly: true,
  },
  // An app can describe a tool's input badly; the tool is still listed.
  { name: "update_meeting_title", description: "Renames one", inputSchema: {}, readOnly: false },
];

const granola = (overrides: Partial<MajordomeConnection> = {}): MajordomeConnection => ({
  appId: "granola",
  name: "Granola",
  state: "connected",
  addedAt: "2026-11-28T00:00:00.000Z",
  routinesMayChange: false,
  ...overrides,
});

/** The tool server with Granola connected, and the hands to change that and to call as someone. */
const setUp = Effect.fn("test.setUp")(function* (initial: ReadonlyArray<MajordomeConnection>) {
  const registered = new Map<string, Registration>();
  const calls: Array<{ readonly name: string; readonly arguments: unknown }> = [];
  const listChanged = yield* Queue.unbounded<void>();
  const changes = yield* Queue.unbounded<void>();
  let connections = initial;
  // The thread whose current run a scheduled task started.
  const routineThread = "thread:routine";

  yield* ConnectionTools.start({
    register: (options) => Effect.sync(() => void registered.set(options.tool.name, options)),
    announce: Queue.offer(listChanged, undefined).pipe(Effect.asVoid),
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(MajordomeConnections.MajordomeConnections)({
          list: Effect.sync(() => ({ apps: [], connections })),
          tools: () => Effect.succeed(GRANOLA_TOOLS),
          callTool: (input) =>
            Effect.sync(() => {
              calls.push({ name: input.name, arguments: input.arguments });
              return { content: [{ type: "text", text: "done" }] };
            }),
          changes: Stream.fromQueue(changes),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadShell: (threadId) => Effect.succeed({ activeRunId: `run:${threadId}` } as never),
          getThreadRecords: (threadId) =>
            Effect.succeed({
              runs: [{ id: `run:${threadId}`, userMessageId: `message:${threadId}` }],
            } as never),
          getMessagesById: (threadId) =>
            Effect.succeed(
              new Map([
                [
                  `message:${threadId}`,
                  threadId === routineThread ? { scheduledTaskId: "task:1" } : {},
                ],
              ]) as never,
            ),
        }),
      ),
    ),
  );
  // Listing what is connected at start-up announces itself once.
  if (initial.length > 0) yield* Queue.take(listChanged);

  const scopeOf = (caller: {
    readonly threadId?: string;
    readonly subagent?: boolean;
    readonly outside?: boolean;
  }) =>
    ({
      thread:
        caller.outside === true
          ? undefined
          : {
              threadId: caller.threadId ?? "thread:chat",
              providerSessionId: "session",
              providerInstanceId: "claude",
              ...(caller.subagent === true ? { subagent: true } : {}),
            },
      client:
        caller.outside === true ? { sessionId: "s", label: "cli", access: "auto" } : undefined,
    }) as unknown as McpInvocationContext.McpInvocationScope;

  return {
    calls,
    routineThread,
    /** The names a caller is shown. */
    shownTo: (caller: Parameters<typeof scopeOf>[0]) =>
      Effect.sync(() =>
        [...registered.values()]
          .filter(({ annotations }) =>
            Context.getUnsafe(
              annotations,
              McpSchema.EnabledWhen,
            )({
              protocolVersion: "",
              capabilities: {},
            }),
          )
          .map(({ tool }) => tool.name),
      ).pipe(Effect.provideService(McpInvocationContext.McpInvocationContext, scopeOf(caller))),
    call: (name: string, caller: Parameters<typeof scopeOf>[0]) =>
      registered
        .get(name)!
        .handle({ title: "Weekly" })
        .pipe(Effect.provideService(McpInvocationContext.McpInvocationContext, scopeOf(caller))),
    /** Changes what is connected and waits until the tool list followed. */
    change: (next: ReadonlyArray<MajordomeConnection>, expectListChange = true) =>
      Effect.gen(function* () {
        connections = next;
        yield* Queue.offer(changes, undefined);
        if (expectListChange) yield* Queue.take(listChanged);
      }),
    registered,
  };
});

const text = (result: McpSchema.CallToolResult) =>
  result.content.map((block) => ("text" in block ? block.text : "")).join("");

it.effect("lists a connected app's tools under the app's name, to chats on this server only", () =>
  Effect.gen(function* () {
    const server = yield* setUp([granola()]);
    assert.deepEqual(yield* server.shownTo({}), [
      "granola_list_meetings",
      "granola_update_meeting_title",
    ]);
    const tool = server.registered.get("granola_list_meetings")!.tool;
    assert.equal(tool.description, "Granola: Lists meetings");
    assert.equal(tool.annotations?.readOnlyHint, true);

    assert.deepEqual(yield* server.shownTo({ outside: true }), []);
    const refused = yield* server.call("granola_list_meetings", { outside: true });
    assert.isTrue(refused.isError);
    assert.deepEqual(server.calls, []);
  }).pipe(Effect.scoped),
);

it.effect("a chat the owner is in may read and change", () =>
  Effect.gen(function* () {
    const server = yield* setUp([granola()]);
    assert.equal(text(yield* server.call("granola_list_meetings", {})), "done");
    assert.equal(text(yield* server.call("granola_update_meeting_title", {})), "done");
    assert.deepEqual(server.calls, [
      { name: "list_meetings", arguments: { title: "Weekly" } },
      { name: "update_meeting_title", arguments: { title: "Weekly" } },
    ]);
  }).pipe(Effect.scoped),
);

it.effect("a routine and a helper task may only read, until the owner allows more", () =>
  Effect.gen(function* () {
    const server = yield* setUp([granola()]);
    const routine = { threadId: server.routineThread };

    assert.equal(text(yield* server.call("granola_list_meetings", routine)), "done");
    const refused = yield* server.call("granola_update_meeting_title", routine);
    assert.isTrue(refused.isError);
    assert.include(text(refused), "may only read");
    assert.isTrue((yield* server.call("granola_update_meeting_title", { subagent: true })).isError);
    assert.deepEqual(
      server.calls.map(({ name }) => name),
      ["list_meetings"],
    );

    // The same tools, so the list does not change: the next call reads the new switch.
    yield* server.change([granola({ routinesMayChange: true })], false);
    yield* server.change([
      granola({ routinesMayChange: true }),
      granola({ appId: "x", name: "X" }),
    ]);
    assert.equal(text(yield* server.call("granola_update_meeting_title", routine)), "done");
  }).pipe(Effect.scoped),
);

it.effect("a disconnected app's tools are hidden and refused, and come back with it", () =>
  Effect.gen(function* () {
    const server = yield* setUp([granola()]);
    yield* server.change([]);
    assert.deepEqual(yield* server.shownTo({}), []);
    assert.isTrue((yield* server.call("granola_list_meetings", {})).isError);

    yield* server.change([granola({ state: "needs-sign-in" })], false);
    yield* server.change([granola()]);
    assert.deepEqual(yield* server.shownTo({}), [
      "granola_list_meetings",
      "granola_update_meeting_title",
    ]);
    assert.equal(text(yield* server.call("granola_list_meetings", {})), "done");
  }).pipe(Effect.scoped),
);
