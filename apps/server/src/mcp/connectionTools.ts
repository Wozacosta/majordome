/**
 * The tools of the apps the owner connected, listed beside Majordome's own. Every AI already
 * gets this server, so a connected app works for each of them with nothing set up per AI, and
 * this is the one place that decides whether a call may run.
 */

import { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpSchema } from "effect/ai";

import * as MajordomeConnections from "../majordome/connections/MajordomeConnections.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { isScheduledRun } from "./scheduledRun.ts";

// Every AI adds its own prefix, and the tightest of them allows 64 characters in all.
const MAX_TOOL_NAME = 48;

const connectionToolName = (appId: string, tool: string) =>
  `${appId}_${tool}`.slice(0, MAX_TOOL_NAME);

const decodeResult = Schema.decodeUnknownOption(McpSchema.CallToolResult);

const refused = (text: string) =>
  new McpSchema.CallToolResult({ content: [{ type: "text", text }], isError: true });

/** The app's answer as it gave it, or as text when it is not shaped like a tool result. */
const asResult = (value: unknown) =>
  Option.getOrElse(
    decodeResult(value),
    () =>
      new McpSchema.CallToolResult({ content: [{ type: "text", text: JSON.stringify(value) }] }),
  );

interface Listed {
  readonly appId: string;
  readonly appName: string;
  readonly tool: MajordomeConnections.AppTool;
  readonly routinesMayChange: boolean;
}

/** How the tool server takes a tool and tells its clients the list changed. */
export interface ToolServer {
  readonly register: (options: {
    readonly tool: McpSchema.Tool;
    readonly annotations: Context.Context<never>;
    readonly handle: (payload: unknown) => Effect.Effect<McpSchema.CallToolResult>;
  }) => Effect.Effect<void>;
  readonly announce: Effect.Effect<void>;
}

/** Lists what is connected now, and keeps the list in step for as long as the scope lives. */
export const start = Effect.fn("connectionTools.start")(function* (server: ToolServer) {
  // Tests of the tool server build it without these; a real server always has both.
  const services = Option.all([
    yield* Effect.serviceOption(MajordomeConnections.MajordomeConnections),
    yield* Effect.serviceOption(ThreadManagementService.ThreadManagementService),
  ]);
  if (Option.isNone(services)) return;
  const [connections, threads] = services.value;
  // What is connected right now, by tool name. A tool stays registered after its app is
  // disconnected, since the server cannot drop one, and is hidden and refused through this.
  const listed = new Map<string, Listed>();

  /**
   * Nobody is watching a routine, or a task one hands to a helper, and what an app returns
   * may be written by someone else. So those only read, unless the owner said otherwise.
   */
  const unattended = Effect.fn("connectionTools.unattended")(function* (
    thread: McpInvocationContext.McpThreadCaller,
  ) {
    if (thread.subagent === true) return true;
    const shell = yield* threads
      .getThreadShell(ThreadId.make(thread.threadId))
      .pipe(Effect.orElseSucceed(() => null));
    // A caller that cannot be looked up is treated as unattended.
    if (shell === null) return true;
    return yield* isScheduledRun(threads, thread.threadId, shell.activeRunId);
  });

  const call = Effect.fn("connectionTools.call")(function* (name: string, payload: unknown) {
    const entry = listed.get(name);
    const scope = Option.getOrUndefined(
      yield* Effect.serviceOption(McpInvocationContext.McpInvocationContext),
    );
    // Only a chat on this server: never an outside program signed in to it, or a linked computer.
    if (entry === undefined || scope?.thread === undefined || scope.client !== undefined) {
      return refused("That app isn't connected here.");
    }
    if (!entry.tool.readOnly && !entry.routinesMayChange && (yield* unattended(scope.thread))) {
      return refused(
        `This would change something in ${entry.appName}, and a routine or a helper task may only read from it. The owner can allow it in Settings, then Connections.`,
      );
    }
    return yield* connections
      .callTool({ appId: entry.appId, name: entry.tool.name, arguments: payload })
      .pipe(
        Effect.match({
          onSuccess: asResult,
          onFailure: (error) => refused(error.message),
        }),
      );
  });

  const sync = Effect.fn("connectionTools.sync")(function* () {
    const { connections: current } = yield* connections.list;
    const next = new Map<string, Listed>();
    for (const connection of current) {
      if (connection.state !== "connected") continue;
      // An app that cannot be reached right now keeps the tools it last listed.
      const tools = yield* connections
        .tools({ appId: connection.appId })
        .pipe(
          Effect.orElseSucceed(() =>
            [...listed.values()]
              .filter((entry) => entry.appId === connection.appId)
              .map((entry) => entry.tool),
          ),
        );
      for (const tool of tools) {
        next.set(connectionToolName(connection.appId, tool.name), {
          appId: connection.appId,
          appName: connection.name,
          tool,
          routinesMayChange: connection.routinesMayChange,
        });
      }
    }
    const before = [...listed.keys()].sort().join("\n");
    for (const [name, entry] of next) {
      if (listed.get(name)?.tool === entry.tool) continue;
      // The library refuses a tool whose description of its input is not well formed. Such a
      // tool is listed as taking anything, and the app itself checks what it is sent.
      const describe = (inputSchema: unknown) =>
        new McpSchema.Tool({
          name,
          description: `${entry.appName}: ${entry.tool.description}`,
          inputSchema: inputSchema as McpSchema.Tool["inputSchema"],
          annotations: { readOnlyHint: entry.tool.readOnly, openWorldHint: true },
        });
      const tool = yield* Effect.try(() => describe(entry.tool.inputSchema)).pipe(
        Effect.orElseSucceed(() => describe({ type: "object" })),
      );
      yield* server.register({
        tool,
        annotations: Context.make(
          McpSchema.EnabledWhen,
          () => listed.has(name) && McpInvocationContext.hiddenFromOutsideClients(),
        ),
        handle: (payload) => call(name, payload),
      });
    }
    listed.clear();
    for (const [name, entry] of next) listed.set(name, entry);
    if ([...listed.keys()].sort().join("\n") !== before) {
      yield* server.announce;
    }
  });

  yield* sync().pipe(Effect.ignore);
  yield* connections.changes.pipe(
    Stream.runForEach(() => sync().pipe(Effect.ignore)),
    Effect.forkScoped,
  );
});
