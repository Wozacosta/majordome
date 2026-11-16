import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import { assert, it } from "@effect/vitest";
import { ClaudeSettings, type ProviderConnector } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";

import {
  buildClaudeConnectorsProbeQueryOptions,
  probeClaudeConnectors,
  readSettledConnectors,
  toProviderConnectors,
} from "./ClaudeConnectorsProbe.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

const decodeClaudeSettings = Schema.decodeEffect(ClaudeSettings);

const gmail = (status: ProviderConnector["status"]): ProviderConnector => ({
  name: "claude.ai Gmail",
  status,
});

/** Answers with each listed read in turn, then keeps repeating the last. */
const readsOf = (reads: ReadonlyArray<ReadonlyArray<ProviderConnector>>) => {
  let count = 0;
  return {
    read: Effect.sync(() => reads[Math.min(count++, reads.length - 1)]!),
    count: () => count,
  };
};

it("starts Claude with MCP on, unlike the capabilities probe", () => {
  const options = buildClaudeConnectorsProbeQueryOptions({
    executablePath: "/usr/bin/claude",
    abortController: new AbortController(),
    environment: { HOME: "/home/user" },
    cwd: undefined,
    spawnVia: undefined,
  });

  assert.equal("mcpServers" in options, false);
  assert.equal(options.strictMcpConfig, undefined);
  assert.equal("ENABLE_CLAUDEAI_MCP_SERVERS" in (options.env ?? {}), false);
  // What a probe must still not do: run the owner's hooks or write a session.
  assert.deepEqual(options.settings, { disableAllHooks: true });
  assert.equal(options.persistSession, false);
  assert.equal(options.env?.HOME, "/home/user");
});

it("keeps each connector's name and status, in name order", () => {
  assert.deepEqual(
    toProviderConnectors([
      { name: "plugin:vercel:vercel", status: "needs-auth" },
      { name: "claude.ai Gmail", status: "connected", scope: "claudeai" } as never,
    ]),
    [
      { name: "claude.ai Gmail", status: "connected" },
      { name: "plugin:vercel:vercel", status: "needs-auth" },
    ],
  );
});

it.effect("answers at once when nothing is still connecting", () =>
  Effect.gen(function* () {
    const reads = readsOf([[gmail("connected")]]);
    assert.deepEqual(yield* readSettledConnectors(reads.read), [gmail("connected")]);
    assert.equal(reads.count(), 1);
  }),
);

it.effect("reads again until every connector has settled", () =>
  Effect.gen(function* () {
    const reads = readsOf([[gmail("pending")], [gmail("pending")], [gmail("needs-auth")]]);
    const settled = yield* Effect.forkChild(readSettledConnectors(reads.read));
    yield* TestClock.adjust("1 second");
    assert.deepEqual(yield* Fiber.join(settled), [gmail("needs-auth")]);
    assert.equal(reads.count(), 3);
  }),
);

it.effect("stops waiting at the deadline and says what is still connecting", () =>
  Effect.gen(function* () {
    const reads = readsOf([[gmail("pending")]]);
    const settled = yield* Effect.forkChild(readSettledConnectors(reads.read));
    yield* TestClock.adjust("20 seconds");
    assert.deepEqual(yield* Fiber.join(settled), [gmail("pending")]);
    // One read at the start, then one every half second up to the deadline.
    assert.equal(reads.count(), 41);
  }),
);

const mockQuery = (mcpServerStatus: () => Promise<ReadonlyArray<ClaudeSdk.McpServerStatus>>) => {
  const seen: { options?: ClaudeSdk.Options | undefined } = {};
  const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(({ options }) => {
    seen.options = options;
    return {
      initializationResult: async () => ({}),
      mcpServerStatus,
    } as unknown as ReturnType<typeof ClaudeSdk.query>;
  });
  return Effect.as(
    Effect.addFinalizer(() => Effect.sync(() => query.mockRestore())),
    seen,
  );
};

it.effect("lists what Claude reports and then stops the Claude it started", () =>
  Effect.gen(function* () {
    const seen = yield* mockQuery(async () => [
      { name: "claude.ai Gmail", status: "connected", scope: "claudeai" },
    ]);
    const connectors = yield* probeClaudeConnectors(
      yield* decodeClaudeSettings({ binaryPath: "claude" }),
      { HOME: "/home/user" },
      undefined,
    );
    assert.deepEqual(connectors, [gmail("connected")]);
    assert.equal(seen.options?.abortController?.signal.aborted, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("stops the Claude it started when the list cannot be read", () =>
  Effect.gen(function* () {
    const seen = yield* mockQuery(() => Promise.reject(new Error("unsupported")));
    const error = yield* probeClaudeConnectors(
      yield* decodeClaudeSettings({ binaryPath: "claude" }),
      { HOME: "/home/user" },
      undefined,
    ).pipe(Effect.flip);
    assert.equal(error._tag, "ClaudeConnectorsProbeError");
    assert.equal(error.message, "Claude could not list its connectors.");
    assert.equal(seen.options?.abortController?.signal.aborted, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
