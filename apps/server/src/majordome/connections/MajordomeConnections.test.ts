import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient } from "effect/http";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { fakeHttp, type FakeReply, type SentRequest } from "../fakeHttp.testkit.ts";
import * as MajordomeConnections from "./MajordomeConnections.ts";

const ORIGIN = "https://quiet-otter.majord.link";

/**
 * Granola as Majordome meets it: its sign-in documents, registration, tokens that are replaced
 * on every renewal, and an MCP endpoint that refuses any token but the newest.
 */
function fakeGranola(options: { readonly session?: boolean } = {}) {
  let issued = 0;
  let live = "";
  let refresh = "";
  let sessionId = 0;
  const calls: Array<{ readonly name: string; readonly arguments: unknown }> = [];
  const state = {
    calls,
    revoked: [] as Array<string>,
    /** The app forgets the token it gave, as when it expires on the app's side. */
    expireToken: () => {
      live = "";
    },
    forgetSession: () => {
      sessionId += 1;
    },
    refuseRefresh: false,
    initializes: 0,
  };
  const issue = (): FakeReply => {
    issued += 1;
    live = `access-${issued}`;
    refresh = `refresh-${issued}`;
    return { body: { access_token: live, refresh_token: refresh, expires_in: 3600 } };
  };
  const http = fakeHttp((sent: SentRequest): FakeReply => {
    switch (sent.route) {
      case "GET mcp.granola.ai/.well-known/oauth-protected-resource/mcp":
        return {
          body: {
            resource: "https://mcp.granola.ai/mcp",
            authorization_servers: ["https://mcp-auth.granola.ai"],
            scopes_supported: ["mcp"],
          },
        };
      case "GET mcp-auth.granola.ai/.well-known/oauth-authorization-server":
        return {
          body: {
            issuer: "https://mcp-auth.granola.ai",
            authorization_endpoint: "https://mcp-auth.granola.ai/oauth2/authorize",
            token_endpoint: "https://mcp-auth.granola.ai/oauth2/token",
            registration_endpoint: "https://mcp-auth.granola.ai/oauth2/register",
            revocation_endpoint: "https://mcp-auth.granola.ai/oauth2/revoke",
            scopes_supported: ["offline_access"],
            code_challenge_methods_supported: ["S256"],
            authorization_response_iss_parameter_supported: true,
          },
        };
      case "POST mcp-auth.granola.ai/oauth2/register":
        return { status: 201, body: { client_id: "client-1" } };
      case "POST mcp-auth.granola.ai/oauth2/revoke":
        state.revoked.push(new URLSearchParams(sent.body).get("token") ?? "");
        return { body: {} };
      case "POST mcp-auth.granola.ai/oauth2/token": {
        const form = new URLSearchParams(sent.body);
        if (form.get("grant_type") === "authorization_code") {
          return form.get("code") === "good-code" && form.get("code_verifier") !== null
            ? issue()
            : { status: 400, body: { error: "invalid_grant" } };
        }
        return !state.refuseRefresh && form.get("refresh_token") === refresh
          ? issue()
          : { status: 400, body: { error: "invalid_grant" } };
      }
      case "POST mcp.granola.ai/mcp": {
        if (live === "" || sent.headers.authorization !== `Bearer ${live}`) return { status: 401 };
        const message = sent.json as {
          readonly id?: number;
          readonly method: string;
          readonly params?: { readonly name: string; readonly arguments: unknown };
        };
        const session = `session-${sessionId}`;
        if (message.method === "initialize") {
          state.initializes += 1;
          return {
            body: { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18" } },
            ...(options.session ? { headers: { "mcp-session-id": session } } : {}),
          };
        }
        if (options.session && sent.headers["mcp-session-id"] !== session) return { status: 404 };
        if (message.method === "notifications/initialized") return { status: 202 };
        if (message.method === "tools/list") {
          return {
            // Granola answers as an event stream.
            headers: { "content-type": "text/event-stream" },
            bytes: new TextEncoder().encode(
              `event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  tools: [
                    {
                      name: "list_meetings",
                      description: "Lists meetings",
                      inputSchema: { type: "object" },
                      annotations: { readOnlyHint: true },
                    },
                    { name: "update_meeting_title", annotations: { readOnlyHint: false } },
                    { name: "unmarked" },
                  ],
                },
              })}\n\n`,
            ),
          };
        }
        if (message.method === "tools/call") {
          calls.push({ name: message.params!.name, arguments: message.params!.arguments });
          return message.params!.name === "broken"
            ? { body: { jsonrpc: "2.0", id: message.id, error: { message: "No such meeting" } } }
            : {
                body: {
                  jsonrpc: "2.0",
                  id: message.id,
                  result: { content: [{ type: "text", text: "3 meetings" }] },
                },
              };
        }
        return { status: 400 };
      }
      default:
        return { status: 404 };
    }
  });
  return { ...state, state, http };
}

const layerFor = (http: HttpClient.HttpClient) =>
  MajordomeConnections.layerWithoutClient.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "majordome-connections-test-" }),
    ),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

/** Signs in to Granola the way the owner's browser would come back. */
const signIn = Effect.fn("test.signIn")(function* (origin = ORIGIN) {
  const connections = yield* MajordomeConnections.MajordomeConnections;
  const { authorizationUrl } = yield* connections.startSignIn({ appId: "granola", origin });
  const url = new URL(authorizationUrl);
  const state = url.searchParams.get("state")!;
  yield* connections.finishSignIn({
    state,
    code: "good-code",
    issuer: "https://mcp-auth.granola.ai",
  });
  return { url, state };
});

it.effect("connects an app, reads its tools and calls one", () => {
  const granola = fakeGranola();
  return Effect.gen(function* () {
    const connections = yield* MajordomeConnections.MajordomeConnections;
    assert.deepEqual((yield* connections.list).connections, []);
    const { url } = yield* signIn();
    assert.equal(url.searchParams.get("redirect_uri"), `${ORIGIN}/oauth/connections/callback`);

    const listed = yield* connections.list;
    assert.deepEqual(
      listed.connections.map(({ appId, name, state, routinesMayChange }) => ({
        appId,
        name,
        state,
        routinesMayChange,
      })),
      [{ appId: "granola", name: "Granola", state: "connected", routinesMayChange: false }],
    );

    const tools = yield* connections.tools({ appId: "granola" });
    assert.deepEqual(
      tools.map(({ name, readOnly }) => [name, readOnly]),
      [
        ["list_meetings", true],
        ["update_meeting_title", false],
        // A tool the app does not mark counts as one that changes something.
        ["unmarked", false],
      ],
    );

    const result = yield* connections.callTool({
      appId: "granola",
      name: "list_meetings",
      arguments: { limit: 3 },
    });
    assert.deepEqual(result, { content: [{ type: "text", text: "3 meetings" }] });
    assert.deepEqual(granola.calls, [{ name: "list_meetings", arguments: { limit: 3 } }]);
    assert.isString((yield* connections.list).connections[0]?.lastUsedAt);
  }).pipe(Effect.provide(layerFor(granola.http.client)));
});

it.effect("a local Majordome is returned to through the page, which carries its address", () => {
  const granola = fakeGranola();
  return Effect.gen(function* () {
    const { url, state } = yield* signIn("http://127.0.0.1:3774");
    assert.equal(url.searchParams.get("redirect_uri"), "https://majord.me/connect/back");
    assert.equal(atob(state.split(".")[1]!), "http://127.0.0.1:3774");
    const connections = yield* MajordomeConnections.MajordomeConnections;
    const refused = yield* connections
      .startSignIn({ appId: "granola", origin: "http://example.com" })
      .pipe(Effect.flip);
    assert.equal(refused.message, "Majordome can't bring the sign-in back to this address.");
  }).pipe(Effect.provide(layerFor(granola.http.client)));
});

it.effect(
  "a sign-in link works once, for ten minutes, and only from the app it was sent to",
  () => {
    const granola = fakeGranola();
    return Effect.gen(function* () {
      const connections = yield* MajordomeConnections.MajordomeConnections;
      const start = connections
        .startSignIn({ appId: "granola", origin: ORIGIN })
        .pipe(
          Effect.map(({ authorizationUrl }) =>
            new URL(authorizationUrl).searchParams.get("state")!,
          ),
        );
      const finish = (state: string, issuer: string | null = "https://mcp-auth.granola.ai") =>
        connections.finishSignIn({ state, code: "good-code", issuer }).pipe(Effect.exit);

      const used = yield* start;
      assert.equal((yield* finish(used))._tag, "Success");
      assert.equal((yield* finish(used))._tag, "Failure");

      assert.equal((yield* finish(yield* start, "https://evil.example"))._tag, "Failure");
      assert.equal((yield* finish(yield* start, null))._tag, "Failure");
      assert.equal((yield* finish("made-up"))._tag, "Failure");

      const late = yield* start;
      yield* TestClock.adjust("11 minutes");
      assert.equal((yield* finish(late))._tag, "Failure");
    }).pipe(Effect.provide(layerFor(granola.http.client)));
  },
);

it.effect("renews a token the app stopped accepting, and one about to end", () => {
  const granola = fakeGranola();
  return Effect.gen(function* () {
    const connections = yield* MajordomeConnections.MajordomeConnections;
    yield* signIn();
    const call = connections.callTool({ appId: "granola", name: "list_meetings", arguments: {} });
    yield* call;

    granola.expireToken();
    // The app refuses, Majordome renews and asks again: the caller sees none of it.
    yield* call;
    assert.equal(granola.calls.length, 2);

    const tokenRequests = () =>
      granola.http.requests.filter((sent) => sent.route.endsWith("/oauth2/token")).length;
    const before = tokenRequests();
    yield* TestClock.adjust("3570 seconds");
    yield* call;
    assert.equal(tokenRequests(), before + 1);
    // The renewed token went out, with no refused request first.
    assert.equal(granola.http.requests.at(-1)?.headers.authorization, "Bearer access-3");
  }).pipe(Effect.provide(layerFor(granola.http.client)));
});

it.effect("says the app needs signing in again when it will not renew", () => {
  const granola = fakeGranola();
  return Effect.gen(function* () {
    const connections = yield* MajordomeConnections.MajordomeConnections;
    yield* signIn();
    granola.expireToken();
    granola.state.refuseRefresh = true;
    const call = connections
      .callTool({ appId: "granola", name: "list_meetings", arguments: {} })
      .pipe(Effect.asVoid, Effect.flip);
    assert.equal(
      (yield* call).message,
      "Granola needs signing in again. Open Settings, then Connections.",
    );
    assert.equal((yield* connections.list).connections[0]?.state, "needs-sign-in");
    // It stays that way without asking the app again.
    const requests = granola.http.requests.length;
    yield* call;
    assert.equal(granola.http.requests.length, requests);

    granola.state.refuseRefresh = false;
    yield* signIn();
    assert.equal((yield* connections.list).connections[0]?.state, "connected");
  }).pipe(Effect.provide(layerFor(granola.http.client)));
});

it.effect("opens the app's session again when the app forgot it", () => {
  const granola = fakeGranola({ session: true });
  return Effect.gen(function* () {
    const connections = yield* MajordomeConnections.MajordomeConnections;
    yield* signIn();
    const call = connections.callTool({ appId: "granola", name: "list_meetings", arguments: {} });
    yield* call;
    yield* call;
    assert.equal(granola.state.initializes, 1);
    granola.forgetSession();
    yield* call;
    assert.equal(granola.state.initializes, 2);
    assert.equal(granola.calls.length, 3);
  }).pipe(Effect.provide(layerFor(granola.http.client)));
});

it.effect("hands the assistant the app's own words when a call is refused", () => {
  const granola = fakeGranola();
  return Effect.gen(function* () {
    const connections = yield* MajordomeConnections.MajordomeConnections;
    yield* signIn();
    const refused = yield* connections
      .callTool({ appId: "granola", name: "broken", arguments: {} })
      .pipe(Effect.asVoid, Effect.flip);
    assert.equal(refused.message, "No such meeting");
  }).pipe(Effect.provide(layerFor(granola.http.client)));
});

it.effect("disconnecting revokes the sign-in at the app and leaves nothing on disk", () => {
  const granola = fakeGranola();
  return Effect.gen(function* () {
    const connections = yield* MajordomeConnections.MajordomeConnections;
    const config = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    yield* signIn();
    assert.isTrue(
      (yield* fileSystem.readDirectory(config.secretsDir)).some((name) =>
        name.includes("majordome-connection-granola"),
      ),
    );
    yield* connections.remove({ appId: "granola" });
    assert.deepEqual(granola.state.revoked, ["refresh-1"]);
    assert.deepEqual((yield* connections.list).connections, []);
    assert.isFalse(
      (yield* fileSystem.readDirectory(config.secretsDir)).some((name) =>
        name.includes("majordome-connection-granola"),
      ),
    );
    const after = yield* connections
      .callTool({ appId: "granola", name: "list_meetings", arguments: {} })
      .pipe(Effect.asVoid, Effect.flip);
    assert.equal(after.message, "That app isn't connected on this computer.");
  }).pipe(Effect.provide(layerFor(granola.http.client)));
});
