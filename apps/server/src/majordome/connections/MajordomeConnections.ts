/**
 * The apps the owner connected on this server. Majordome signs in to each app's MCP server
 * itself, keeps and renews the token, and makes the calls, so a connection works for every AI
 * and the token is never handed to one.
 */

import {
  type MajordomeConnection,
  MajordomeConnectionsError,
  type MajordomeConnectionsResult,
} from "@t3tools/contracts";
import { MAJORDOME_APPS, type MajordomeAppEntry } from "@t3tools/shared/majordomeApps";
import { connectionCallback } from "@t3tools/shared/majordomeConnections";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import * as McpWebhookTransport from "../../mcp/McpWebhookTransport.ts";
import * as SignIn from "./connectionSignIn.ts";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const ATTEMPT_LIFETIME_MS = 10 * 60_000;
const MAX_ATTEMPTS = 20;
// A token this close to its end is renewed before use rather than after a refusal.
const RENEW_BEFORE_MS = 60_000;
const LIST_TIMEOUT = "30 seconds";
const CALL_TIMEOUT = "5 minutes";
const MAX_TOOL_PAGES = 20;

/** A tool as the app describes it. `readOnly` is the app's own word for it. */
export interface AppTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly readOnly: boolean;
}

export class MajordomeConnections extends Context.Service<
  MajordomeConnections,
  {
    readonly list: Effect.Effect<MajordomeConnectionsResult>;
    /** Starts a sign-in and answers with the app's page for the owner to approve on. */
    readonly startSignIn: (input: {
      readonly appId: string;
      /** The address the owner's browser reaches this server at. */
      readonly origin: string;
    }) => Effect.Effect<{ readonly authorizationUrl: string }, MajordomeConnectionsError>;
    /**
     * What the callback page hands over. A `state` is good once and for ten minutes; anything
     * else fails without saying why to the page, which anyone can open.
     */
    readonly finishSignIn: (input: {
      readonly state: string;
      readonly code: string | null;
      readonly issuer: string | null;
    }) => Effect.Effect<{ readonly name: string }, MajordomeConnectionsError>;
    /** Forgets the connection, after telling the app to forget the token where it can. */
    readonly remove: (input: {
      readonly appId: string;
    }) => Effect.Effect<void, MajordomeConnectionsError>;
    readonly setRoutinesMayChange: (input: {
      readonly appId: string;
      readonly routinesMayChange: boolean;
    }) => Effect.Effect<MajordomeConnection, MajordomeConnectionsError>;
    /** The tools of a connected app, read from the app and kept until it is asked again. */
    readonly tools: (input: {
      readonly appId: string;
      readonly refresh?: boolean | undefined;
    }) => Effect.Effect<ReadonlyArray<AppTool>, MajordomeConnectionsError>;
    /** Calls one tool and answers with the app's result as it gave it. */
    readonly callTool: (input: {
      readonly appId: string;
      readonly name: string;
      readonly arguments: unknown;
    }) => Effect.Effect<unknown, MajordomeConnectionsError>;
    /** One event each time the set of connections, or one's state, changes. */
    readonly changes: Stream.Stream<void>;
  }
>()("t3/majordome/connections/MajordomeConnections") {}

const SignInServer = Schema.Struct({
  resource: Schema.String,
  issuer: Schema.String,
  authorizationEndpoint: Schema.String,
  tokenEndpoint: Schema.String,
  registrationEndpoint: Schema.String,
  revocationEndpoint: Schema.NullOr(Schema.String),
  scope: Schema.NullOr(Schema.String),
  namesItselfInCallback: Schema.Boolean,
});

const Stored = Schema.Record(
  Schema.String,
  Schema.Struct({
    name: Schema.String,
    // Kept from the day of the sign-in: a later change to the app list never moves a token.
    server: SignInServer,
    clientId: Schema.String,
    state: Schema.Literals(["connected", "needs-sign-in"]),
    addedAt: Schema.String,
    lastUsedAt: Schema.optional(Schema.String),
    routinesMayChange: Schema.Boolean,
  }),
);
type Stored = typeof Stored.Type;
const StoredJson = Schema.fromJsonString(Stored);
const decodeStored = Schema.decodeUnknownOption(StoredJson);
const encodeStored = Schema.encodeSync(StoredJson);

const Tokens = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
});
const TokensJson = Schema.fromJsonString(Tokens);
const decodeTokens = Schema.decodeUnknownOption(TokensJson);
const encodeTokens = Schema.encodeSync(TokensJson);

const RpcReply = Schema.Struct({
  id: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
});
const decodeRpcReply = Schema.decodeUnknownOption(Schema.fromJsonString(RpcReply));

const ToolsPage = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optional(Schema.String),
      inputSchema: Schema.optional(Schema.Unknown),
      annotations: Schema.optional(
        Schema.Struct({ readOnlyHint: Schema.optional(Schema.Boolean) }),
      ),
    }),
  ),
  nextCursor: Schema.optional(Schema.String),
});
const decodeToolsPage = Schema.decodeUnknownOption(ToolsPage);

const secretName = (appId: string) => `majordome-connection-${appId}`;

const fail = (message: string) => new MajordomeConnectionsError({ message });
const NOT_CONNECTED = "That app isn't connected on this computer.";
const signInAgain = (name: string) =>
  `${name} needs signing in again. Open Settings, then Connections.`;

/** The reply to request `id` in a body that is either one JSON message or an event stream. */
function replyIn(body: string, contentType: string, id: number) {
  const candidates = contentType.includes("text/event-stream")
    ? body
        .split(/\r\n|\r|\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
    : [body];
  for (const candidate of candidates) {
    const reply = decodeRpcReply(candidate);
    if (Option.isSome(reply) && reply.value.id === id) return reply.value;
  }
  return undefined;
}

interface Attempt {
  readonly app: MajordomeAppEntry;
  readonly server: SignIn.SignInServer;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly verifier: string;
  readonly expiresAt: number;
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const http = yield* HttpClient.HttpClient;
  const random = yield* SecureRandom.SecureRandom;
  const digester = yield* Digest.Digest;
  const changed = yield* PubSub.sliding<void>(1);

  const storePath = path.join(config.stateDir, "majordome", "connections.json");
  // The list and each token are read, changed and written whole: one writer at a time.
  const lock = yield* Semaphore.make(1);
  const attempts = new Map<string, Attempt>();
  const toolLists = new Map<string, ReadonlyArray<AppTool>>();
  // The app's own session for this server, where it keeps one. Null while none is open.
  const sessions = new Map<string, { readonly id: string | null }>();
  let nextRequestId = 1;

  const withSignIn = <A, E>(
    effect: Effect.Effect<A, E, HttpClient.HttpClient | SecureRandom.SecureRandom | Digest.Digest>,
  ) =>
    effect.pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provideService(SecureRandom.SecureRandom, random),
      Effect.provideService(Digest.Digest, digester),
    );

  const readStored = fileSystem.readFileString(storePath).pipe(
    Effect.option,
    Effect.map((text) => Option.getOrElse(Option.flatMap(text, decodeStored), (): Stored => ({}))),
  );

  const writeStored = Effect.fn("MajordomeConnections.writeStored")(function* (stored: Stored) {
    const temporary = `${storePath}.${yield* random.uuidV4()}.tmp`;
    yield* fileSystem.makeDirectory(path.dirname(storePath), { recursive: true });
    yield* fileSystem.writeFileString(temporary, encodeStored(stored));
    yield* fileSystem.rename(temporary, storePath);
  }, Effect.orDie);

  /** For callers that already hold `lock`. */
  const updateHeld = Effect.fn("MajordomeConnections.update")(function* (
    appId: string,
    change: (entry: Stored[string]) => Stored[string],
  ) {
    const stored = yield* readStored;
    const entry = stored[appId];
    if (entry === undefined) return;
    yield* writeStored({ ...stored, [appId]: change(entry) });
    yield* PubSub.publish(changed, undefined);
  });
  const update = (appId: string, change: (entry: Stored[string]) => Stored[string]) =>
    updateHeld(appId, change).pipe(lock.withPermits(1));

  const readTokens = (appId: string) =>
    secrets.get(secretName(appId)).pipe(
      Effect.map(Option.flatMap((bytes) => decodeTokens(new TextDecoder().decode(bytes)))),
      Effect.orElseSucceed(() => Option.none<SignIn.ConnectionTokens>()),
    );

  const writeTokens = (appId: string, tokens: SignIn.ConnectionTokens) =>
    secrets
      .set(secretName(appId), new TextEncoder().encode(encodeTokens(tokens)))
      .pipe(Effect.mapError(() => fail("Majordome couldn't save the sign-in on this computer.")));

  const describe = (appId: string, entry: Stored[string]): MajordomeConnection => ({
    appId,
    name: entry.name,
    state: entry.state,
    addedAt: entry.addedAt,
    ...(entry.lastUsedAt === undefined ? {} : { lastUsedAt: entry.lastUsedAt }),
    routinesMayChange: entry.routinesMayChange,
  });

  const list: MajordomeConnections["Service"]["list"] = readStored.pipe(
    Effect.map((stored) => ({
      apps: MAJORDOME_APPS.map(({ id, name, about }) => ({ id, name, about })),
      connections: Object.entries(stored).map(([appId, entry]) => describe(appId, entry)),
    })),
  );

  const startSignIn: MajordomeConnections["Service"]["startSignIn"] = Effect.fn(
    "MajordomeConnections.startSignIn",
  )(function* (input) {
    const app = MAJORDOME_APPS.find((candidate) => candidate.id === input.appId);
    if (app === undefined) return yield* fail("Majordome doesn't know that app.");
    const attempt = yield* withSignIn(SignIn.makeAttempt());
    const callback = connectionCallback({ origin: input.origin, nonce: attempt.state });
    if (callback === null) {
      return yield* fail("Majordome can't bring the sign-in back to this address.");
    }
    const signIn = Effect.gen(function* () {
      const server = yield* SignIn.discover(app.address);
      const { clientId } = yield* SignIn.register(server, callback.redirectUri);
      return { server, clientId };
    });
    const { server, clientId } = yield* withSignIn(signIn).pipe(
      Effect.mapError((error) => fail(`${app.name}: ${error.detail}`)),
    );
    const now = yield* Clock.currentTimeMillis;
    for (const [state, pending] of attempts) {
      if (pending.expiresAt <= now) attempts.delete(state);
    }
    while (attempts.size >= MAX_ATTEMPTS) attempts.delete(attempts.keys().next().value!);
    attempts.set(callback.state, {
      app,
      server,
      clientId,
      redirectUri: callback.redirectUri,
      verifier: attempt.verifier,
      expiresAt: now + ATTEMPT_LIFETIME_MS,
    });
    return {
      authorizationUrl: SignIn.authorizationUrl({
        server,
        clientId,
        redirectUri: callback.redirectUri,
        state: callback.state,
        challenge: attempt.challenge,
      }),
    };
  });

  const finishSignIn: MajordomeConnections["Service"]["finishSignIn"] = Effect.fn(
    "MajordomeConnections.finishSignIn",
  )(function* (input) {
    const attempt = attempts.get(input.state);
    attempts.delete(input.state);
    const now = yield* Clock.currentTimeMillis;
    if (
      attempt === undefined ||
      attempt.expiresAt <= now ||
      input.code === null ||
      !SignIn.callbackIssuerMatches(attempt.server, input.issuer)
    ) {
      return yield* fail("This sign-in could not be finished. Start it again from Majordome.");
    }
    const tokens = yield* withSignIn(
      SignIn.exchange({
        server: attempt.server,
        clientId: attempt.clientId,
        redirectUri: attempt.redirectUri,
        code: input.code,
        verifier: attempt.verifier,
        now,
      }),
    ).pipe(Effect.mapError((error) => fail(`${attempt.app.name}: ${error.detail}`)));
    const addedAt = DateTime.formatIso(yield* DateTime.now);
    yield* Effect.gen(function* () {
      yield* writeTokens(attempt.app.id, tokens);
      const stored = yield* readStored;
      yield* writeStored({
        ...stored,
        [attempt.app.id]: {
          name: attempt.app.name,
          server: attempt.server,
          clientId: attempt.clientId,
          state: "connected",
          addedAt: stored[attempt.app.id]?.addedAt ?? addedAt,
          routinesMayChange: stored[attempt.app.id]?.routinesMayChange ?? false,
        },
      });
    }).pipe(lock.withPermits(1));
    sessions.delete(attempt.app.id);
    toolLists.delete(attempt.app.id);
    yield* PubSub.publish(changed, undefined);
    return { name: attempt.app.name };
  });

  const connected = Effect.fn("MajordomeConnections.connected")(function* (appId: string) {
    const entry = (yield* readStored)[appId];
    if (entry === undefined) return yield* fail(NOT_CONNECTED);
    return entry;
  });

  // Only `accessToken` marks it, and it runs holding `lock`.
  const markNeedsSignIn = (appId: string) =>
    updateHeld(appId, (entry) => ({ ...entry, state: "needs-sign-in" }));

  /**
   * Runs holding `lock`. A token to call the app with, renewed first when it is near its end or `renew` says the app
   * refused it. The new token is saved before anyone uses it: an app that retires the old
   * refresh token on use would otherwise be lost to a crash in between.
   */
  const accessToken = Effect.fn("MajordomeConnections.accessToken")(function* (
    appId: string,
    entry: Stored[string],
    renew: boolean,
  ) {
    const held = Option.getOrUndefined(yield* readTokens(appId));
    if (held === undefined) {
      yield* markNeedsSignIn(appId);
      return yield* fail(signInAgain(entry.name));
    }
    const now = yield* Clock.currentTimeMillis;
    const ending = held.expiresAt !== null && held.expiresAt - now < RENEW_BEFORE_MS;
    if (!renew && !ending) return held.accessToken;
    if (held.refreshToken === null) {
      yield* markNeedsSignIn(appId);
      return yield* fail(signInAgain(entry.name));
    }
    const renewed = yield* withSignIn(
      SignIn.refresh({
        server: entry.server,
        clientId: entry.clientId,
        refreshToken: held.refreshToken,
        now,
      }),
    ).pipe(
      Effect.catch((error) =>
        (error.needsSignIn ? markNeedsSignIn(appId) : Effect.void).pipe(
          Effect.andThen(
            Effect.fail(
              fail(
                error.needsSignIn
                  ? signInAgain(entry.name)
                  : `${entry.name} couldn't be reached. Try again in a moment.`,
              ),
            ),
          ),
        ),
      ),
    );
    yield* writeTokens(appId, renewed);
    return renewed.accessToken;
  });

  /** One request to the app. Answers with the status and what came back for `id`, if anything. */
  const post = Effect.fn("MajordomeConnections.post")(function* (input: {
    readonly entry: Stored[string];
    readonly token: string;
    readonly sessionId: string | null;
    readonly message: { readonly id?: number; readonly method: string; readonly params?: unknown };
    readonly timeout: "30 seconds" | "5 minutes";
  }) {
    const response = yield* http
      .execute(
        HttpClientRequest.post(input.entry.server.resource).pipe(
          HttpClientRequest.setHeaders({
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${input.token}`,
            "mcp-protocol-version": MCP_PROTOCOL_VERSION,
            ...(input.sessionId === null ? {} : { "mcp-session-id": input.sessionId }),
          }),
          HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", ...input.message }),
        ),
      )
      .pipe(
        Effect.flatMap((answer) =>
          answer.text.pipe(
            Effect.orElseSucceed(() => ""),
            Effect.map((body) => ({
              status: answer.status,
              sessionId: answer.headers["mcp-session-id"] ?? null,
              reply:
                input.message.id === undefined
                  ? undefined
                  : replyIn(body, answer.headers["content-type"] ?? "", input.message.id),
            })),
          ),
        ),
        Effect.timeout(input.timeout),
        Effect.orElseSucceed(() => ({ status: 0, sessionId: null, reply: undefined })),
      );
    return response;
  });

  const openSession = Effect.fn("MajordomeConnections.openSession")(function* (
    appId: string,
    entry: Stored[string],
    token: string,
  ) {
    const known = sessions.get(appId);
    if (known !== undefined) return { ...known, status: 200 };
    const opened = yield* post({
      entry,
      token,
      sessionId: null,
      timeout: LIST_TIMEOUT,
      message: {
        id: nextRequestId++,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "Majordome", version: "1" },
        },
      },
    });
    if (opened.reply?.result === undefined) return { id: null, status: opened.status || 502 };
    yield* post({
      entry,
      token,
      sessionId: opened.sessionId,
      timeout: LIST_TIMEOUT,
      message: { method: "notifications/initialized" },
    });
    sessions.set(appId, { id: opened.sessionId });
    return { id: opened.sessionId, status: 200 };
  });

  /**
   * A request to the app, with what a long-lived connection needs around it: a token renewed
   * once when the app refuses it, and a session opened again once when the app forgot it.
   */
  const request = Effect.fn("MajordomeConnections.request")(function* (
    appId: string,
    method: string,
    params: unknown,
    timeout: "30 seconds" | "5 minutes",
  ) {
    const entry = yield* connected(appId);
    if (entry.state === "needs-sign-in") return yield* fail(signInAgain(entry.name));
    let token = yield* accessToken(appId, entry, false).pipe(lock.withPermits(1));
    for (const attempt of [1, 2, 3]) {
      const session = yield* openSession(appId, entry, token);
      const answer =
        session.status === 200
          ? yield* post({
              entry,
              token,
              sessionId: session.id,
              timeout,
              message: { id: nextRequestId++, method, params },
            })
          : { status: session.status, reply: undefined };
      if (answer.status === 401 && attempt < 3) {
        sessions.delete(appId);
        token = yield* accessToken(appId, entry, true).pipe(lock.withPermits(1));
        continue;
      }
      if (answer.status === 404 && attempt < 3) {
        sessions.delete(appId);
        continue;
      }
      if (answer.reply?.error !== undefined) {
        // The app's own words for a refused call are for the assistant to read and act on.
        return yield* fail(answer.reply.error.message ?? `${entry.name} refused that.`);
      }
      if (answer.reply?.result === undefined) {
        return yield* fail(`${entry.name} couldn't be reached. Try again in a moment.`);
      }
      return answer.reply.result;
    }
    return yield* fail(`${entry.name} couldn't be reached. Try again in a moment.`);
  });

  const tools: MajordomeConnections["Service"]["tools"] = Effect.fn("MajordomeConnections.tools")(
    function* (input) {
      const kept = toolLists.get(input.appId);
      if (kept !== undefined && input.refresh !== true) return kept;
      const found: Array<AppTool> = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_TOOL_PAGES; page++) {
        const result = decodeToolsPage(
          yield* request(
            input.appId,
            "tools/list",
            cursor === undefined ? {} : { cursor },
            LIST_TIMEOUT,
          ),
        );
        if (Option.isNone(result)) return yield* fail("The app's list of tools could not be read.");
        for (const tool of result.value.tools) {
          found.push({
            name: tool.name,
            description: tool.description ?? "",
            inputSchema: tool.inputSchema ?? { type: "object" },
            // Unmarked counts as a tool that changes something.
            readOnly: tool.annotations?.readOnlyHint === true,
          });
        }
        cursor = result.value.nextCursor;
        if (cursor === undefined) break;
      }
      toolLists.set(input.appId, found);
      return found;
    },
  );

  const callTool: MajordomeConnections["Service"]["callTool"] = Effect.fn(
    "MajordomeConnections.callTool",
  )(function* (input) {
    const result = yield* request(
      input.appId,
      "tools/call",
      { name: input.name, arguments: input.arguments ?? {} },
      CALL_TIMEOUT,
    );
    const lastUsedAt = DateTime.formatIso(yield* DateTime.now);
    // The hour is enough for "last used", and keeps a busy chat from rewriting the file.
    yield* connected(input.appId).pipe(
      Effect.flatMap((entry) =>
        entry.lastUsedAt?.slice(0, 13) === lastUsedAt.slice(0, 13)
          ? Effect.void
          : update(input.appId, (current) => ({ ...current, lastUsedAt })),
      ),
      Effect.ignore,
    );
    return result;
  });

  const remove: MajordomeConnections["Service"]["remove"] = Effect.fn(
    "MajordomeConnections.remove",
  )(function* (input) {
    yield* Effect.gen(function* () {
      const stored = yield* readStored;
      const entry = stored[input.appId];
      if (entry === undefined) return;
      const tokens = Option.getOrUndefined(yield* readTokens(input.appId));
      if (tokens !== undefined) {
        yield* withSignIn(
          SignIn.revoke({ server: entry.server, clientId: entry.clientId, tokens }),
        );
      }
      yield* secrets.remove(secretName(input.appId)).pipe(Effect.ignore);
      const { [input.appId]: _removed, ...rest } = stored;
      yield* writeStored(rest);
    }).pipe(lock.withPermits(1));
    sessions.delete(input.appId);
    toolLists.delete(input.appId);
    yield* PubSub.publish(changed, undefined);
  });

  const setRoutinesMayChange: MajordomeConnections["Service"]["setRoutinesMayChange"] = Effect.fn(
    "MajordomeConnections.setRoutinesMayChange",
  )(function* (input) {
    yield* update(input.appId, (entry) => ({
      ...entry,
      routinesMayChange: input.routinesMayChange,
    }));
    return describe(input.appId, yield* connected(input.appId));
  });

  return MajordomeConnections.of({
    list,
    startSignIn,
    finishSignIn,
    remove,
    setRoutinesMayChange,
    tools,
    callTool,
    changes: Stream.fromPubSub(changed),
  });
});

/** Without the client: tests answer the app themselves. */
export const layerWithoutClient = Layer.effect(MajordomeConnections, make);

/** Every address after the app's own comes from the app, so requests only reach public ones. */
export const layer = layerWithoutClient.pipe(
  Layer.provide(McpWebhookTransport.make([]).layerClient),
);
