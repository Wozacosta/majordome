import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as McpToolAccessTestkit from "../mcp/McpToolAccess.testkit.ts";
import * as ServerSettings from "../serverSettings.ts";

it.effect("a chat is not listed the coding tools, and can still call one", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const token = "notesToken";
      const scope: McpInvocationContext.McpThreadInvocationScope = {
        environmentId: EnvironmentId.make("environment-hidden-tools"),
        requestNamespace: token,
        thread: {
          threadId: ThreadId.make("thread-notes"),
          providerSessionId: token,
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration"]),
        issuedAt: 1,
      };
      const answer = { success: Schema.Struct({ ok: Schema.Boolean }) };
      const Tools = Toolkit.make(
        Tool.make("link_pull_request", { description: "Links a pull request.", ...answer }),
        Tool.make("t3_worktree_list", { description: "Lists worktrees.", ...answer }),
        Tool.make("list_reading", { description: "Lists the reading list.", ...answer }),
      );
      const ok = McpToolAccess.reads(() => Effect.succeed({ ok: true }));
      const serverLayer = McpHttpServer.layerMcpTransport(
        Layer.mergeAll(
          McpHttpServer.toolkitRegistration(
            Tools,
            McpToolAccess.toLayer(Tools, {
              link_pull_request: ok,
              t3_worktree_list: ok,
              list_reading: ok,
            }),
          ),
          McpHttpServer.layerMajordomeHiddenTools,
        ),
      ).pipe(
        Layer.provide(ServerSettings.layerTest()),
        Layer.provide(McpToolAccessTestkit.liveThreadsLayer),
        Layer.provide(
          Layer.mock(McpSessionRegistry.McpSessionRegistry)({
            resolve: (presented) => Effect.succeed(presented === token ? scope : undefined),
          }),
        ),
      );
      yield* HttpRouter.serve(serverLayer, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.build,
      );
      const httpClient = yield* HttpClient.HttpClient;
      const headers = {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      };
      const initialize = yield* httpClient.post("/mcp", {
        headers,
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}`,
          "application/json",
        ),
      });
      const rpc = (method: string, params: object) =>
        httpClient
          .post("/mcp", {
            headers: {
              ...headers,
              "mcp-session-id": initialize.headers["mcp-session-id"]!,
              "mcp-protocol-version": "2025-06-18",
            },
            body: HttpBody.text(
              JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }),
              "application/json",
            ),
          })
          .pipe(Effect.flatMap((response) => response.json));

      const listed = (yield* rpc("tools/list", {})) as {
        result: { tools: ReadonlyArray<{ name: string }> };
      };
      expect(listed.result.tools.map((tool) => tool.name)).toEqual(["list_reading"]);

      const called = (yield* rpc("tools/call", { name: "link_pull_request", arguments: {} })) as {
        result: { isError?: boolean; structuredContent?: unknown };
      };
      expect(called.result.structuredContent).toEqual({ ok: true });
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
