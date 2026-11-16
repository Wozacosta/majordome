/**
 * Asks Claude Code which connectors (MCP servers) a session on this machine would have: the
 * account's claude.ai connectors, plugins' servers and the ones in the user's config. Unlike the
 * capabilities probe, which turns MCP off to stay fast, this one starts Claude as a session does.
 */

import {
  query as claudeQuery,
  type McpServerStatus,
  type Options as ClaudeQueryOptions,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSettings, ProviderConnector } from "@t3tools/contracts";
import { resolveProviderProbeTimeoutMs } from "@t3tools/provider-core/server/snapshotProbe";
import { supportsEnvChdir } from "@t3tools/shared/envTrampoline";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { buildClaudeCapabilitiesProbeQueryOptions } from "./ClaudeProvider.ts";
import { resolveClaudeSdkExecutablePath } from "./Drivers/ClaudeExecutable.ts";
import { makeClaudeEnvironment } from "./Drivers/ClaudeHome.ts";

// Same allowance as the capabilities probe: Bedrock start-up outlasts first-party sign-in.
const INITIALIZE_TIMEOUT_MS = 25_000;
// Connectors over the network answer within seconds; one that is still connecting after this
// is reported as such instead of holding the page.
const SETTLE_DEADLINE_MS = 20_000;
const SETTLE_INTERVAL_MS = 500;
const READ_TIMEOUT_MS = 10_000;

export class ClaudeConnectorsProbeError extends Schema.TaggedError<ClaudeConnectorsProbeError>()(
  "ClaudeConnectorsProbeError",
  { operation: Schema.Literals(["initialize", "status"]), cause: Schema.Defect() },
) {
  override get message(): string {
    return this.operation === "initialize"
      ? "Claude could not start to list its connectors."
      : "Claude could not list its connectors.";
  }
}

export function toProviderConnectors(
  statuses: ReadonlyArray<Pick<McpServerStatus, "name" | "status">>,
): ReadonlyArray<ProviderConnector> {
  return statuses
    .map(({ name, status }) => ({ name, status }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

/**
 * Connectors connect in the background after Claude starts, so the first answer lists most as
 * `pending`. Reads again until none is, or the deadline passes, and answers with the last read.
 */
export const readSettledConnectors = Effect.fnUntraced(function* <E, R>(
  read: Effect.Effect<ReadonlyArray<ProviderConnector>, E, R>,
) {
  const deadline = (yield* Clock.currentTimeMillis) + SETTLE_DEADLINE_MS;
  let connectors = yield* read;
  while (
    connectors.some((connector) => connector.status === "pending") &&
    (yield* Clock.currentTimeMillis) < deadline
  ) {
    yield* Effect.sleep(SETTLE_INTERVAL_MS);
    connectors = yield* read;
  }
  return connectors;
});

/** The capabilities probe's launch, with MCP left on as a session has it. */
export function buildClaudeConnectorsProbeQueryOptions(
  input: Omit<Parameters<typeof buildClaudeCapabilitiesProbeQueryOptions>[0], "managedMcpConfig">,
): ClaudeQueryOptions {
  const {
    mcpServers: _noServers,
    env,
    ...options
  } = buildClaudeCapabilitiesProbeQueryOptions({ ...input, managedMcpConfig: true });
  const { ENABLE_CLAUDEAI_MCP_SERVERS: _claudeAiOff, ...sessionEnv } = env ?? {};
  return { ...options, env: sessionEnv };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/** A never-yielding prompt starts Claude and its connectors without sending an Anthropic request. */
function startConnectorsQuery(
  input: Omit<Parameters<typeof buildClaudeConnectorsProbeQueryOptions>[0], "abortController">,
) {
  const abort = new AbortController();
  const query = claudeQuery({
    // oxlint-disable-next-line require-yield -- never yields, so no prompt reaches the API
    prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
      await waitForAbort(abort.signal);
    })(),
    options: buildClaudeConnectorsProbeQueryOptions({ ...input, abortController: abort }),
  });
  return { query, stop: () => abort.abort() };
}

/** Starts Claude, lists its connectors once they have settled, and stops it again whatever happens. */
export const probeClaudeConnectors = Effect.fn("ClaudeConnectorsProbe.probe")(function* (
  claudeSettings: ClaudeSettings,
  environment: NodeJS.ProcessEnv | undefined,
  cwd: string | undefined,
) {
  const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
  const executablePath = yield* resolveClaudeSdkExecutablePath(
    claudeSettings.binaryPath,
    claudeEnvironment,
  );
  const platform = yield* HostProcess.Platform;
  const spawnVia =
    platform === "win32"
      ? "launcher-thread"
      : platform === "linux" && (yield* Effect.promise(supportsEnvChdir))
        ? "env"
        : undefined;
  return yield* Effect.acquireUseRelease(
    Effect.try({
      try: () =>
        startConnectorsQuery({ executablePath, environment: claudeEnvironment, cwd, spawnVia }),
      catch: (cause) => new ClaudeConnectorsProbeError({ operation: "initialize", cause }),
    }),
    Effect.fnUntraced(function* ({ query }) {
      yield* Effect.tryPromise({
        try: () => query.initializationResult(),
        catch: (cause) => new ClaudeConnectorsProbeError({ operation: "initialize", cause }),
      }).pipe(
        Effect.timeout(resolveProviderProbeTimeoutMs("claude", INITIALIZE_TIMEOUT_MS, environment)),
      );
      return yield* readSettledConnectors(
        Effect.tryPromise({
          try: () => query.mcpServerStatus(),
          catch: (cause) => new ClaudeConnectorsProbeError({ operation: "status", cause }),
        }).pipe(Effect.timeout(READ_TIMEOUT_MS), Effect.map(toProviderConnectors)),
      );
    }),
    ({ stop }) => Effect.sync(stop),
  );
});
