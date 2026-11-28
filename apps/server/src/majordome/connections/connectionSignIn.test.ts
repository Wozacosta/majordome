import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http";

import { fakeHttp, type FakeReply, type SentRequest } from "../fakeHttp.testkit.ts";
import * as SignIn from "./connectionSignIn.ts";

const RESOURCE = "https://mcp.app.example/mcp";
const ISSUER = "https://auth.app.example";

const protectedResource = {
  resource: RESOURCE,
  authorization_servers: [ISSUER],
  scopes_supported: ["mcp"],
};
const authorizationServer = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  registration_endpoint: `${ISSUER}/register`,
  revocation_endpoint: `${ISSUER}/revoke`,
  scopes_supported: ["offline_access", "openid"],
  code_challenge_methods_supported: ["S256"],
  authorization_response_iss_parameter_supported: true,
};

/** An app that answers its two sign-in documents, with any part replaced. */
const app = (
  overrides: {
    readonly protectedResource?: object | null;
    readonly authorizationServer?: object | null;
  } = {},
  rest: (sent: SentRequest) => FakeReply = () => ({ status: 404 }),
) =>
  fakeHttp((sent) => {
    if (sent.route === "GET mcp.app.example/.well-known/oauth-protected-resource/mcp") {
      return overrides.protectedResource === null
        ? { status: 404 }
        : { body: { ...protectedResource, ...overrides.protectedResource } };
    }
    if (sent.route === "GET auth.app.example/.well-known/oauth-authorization-server") {
      return overrides.authorizationServer === null
        ? { status: 404 }
        : { body: { ...authorizationServer, ...overrides.authorizationServer } };
    }
    return rest(sent);
  });

const withHttp = <A, E>(
  http: ReturnType<typeof fakeHttp>,
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
) => effect.pipe(Effect.provideService(HttpClient.HttpClient, http.client));

const server: SignIn.SignInServer = {
  resource: RESOURCE,
  issuer: ISSUER,
  authorizationEndpoint: `${ISSUER}/authorize`,
  tokenEndpoint: `${ISSUER}/token`,
  registrationEndpoint: `${ISSUER}/register`,
  revocationEndpoint: `${ISSUER}/revoke`,
  scope: "mcp offline_access",
  namesItselfInCallback: true,
};

it.effect("finds where an app is signed in to and asks to stay signed in", () =>
  Effect.gen(function* () {
    const found = yield* withHttp(app(), SignIn.discover(RESOURCE));
    assert.deepEqual(found, server);
  }),
);

it.effect("refuses an app whose sign-in documents do not agree with what was asked", () =>
  Effect.gen(function* () {
    const refused = (overrides: Parameters<typeof app>[0]) =>
      withHttp(app(overrides), SignIn.discover(RESOURCE)).pipe(
        Effect.flip,
        Effect.map((error) => error.detail),
      );
    assert.equal(
      yield* refused({ protectedResource: { resource: "https://other.example/mcp" } }),
      "This app's sign-in details are for another address.",
    );
    assert.equal(
      yield* refused({ authorizationServer: { issuer: "https://evil.example" } }),
      "This app's sign-in server gives another name than its own.",
    );
    assert.equal(
      yield* refused({ authorizationServer: { code_challenge_methods_supported: ["plain"] } }),
      "This app's sign-in is not safe enough to use.",
    );
    assert.equal(
      yield* refused({ authorizationServer: { token_endpoint: "http://auth.app.example/token" } }),
      "This app's sign-in is not safe enough to use.",
    );
    assert.equal(
      yield* refused({ authorizationServer: { registration_endpoint: undefined } }),
      "This app only accepts programs it has approved by hand.",
    );
    assert.equal(
      yield* refused({ protectedResource: null }),
      "This app does not say where to sign in.",
    );
  }),
);

it.effect("registers as a native program on loopback and a web one elsewhere", () =>
  Effect.gen(function* () {
    const http = fakeHttp(() => ({ status: 201, body: { client_id: "client-1" } }));
    const local = yield* withHttp(
      http,
      SignIn.register(server, "http://127.0.0.1:3774/oauth/connections/callback"),
    );
    yield* withHttp(
      http,
      SignIn.register(server, "https://me.majord.link/oauth/connections/callback"),
    );
    assert.equal(local.clientId, "client-1");
    assert.deepEqual(
      http.requests.map((sent) => (sent.json as { application_type: string }).application_type),
      ["native", "web"],
    );
    assert.equal(
      (http.requests[0]!.json as { token_endpoint_auth_method: string }).token_endpoint_auth_method,
      "none",
    );
  }),
);

it.effect("sends the owner to approve with a challenge only this attempt can answer", () =>
  Effect.gen(function* () {
    const attempt = yield* SignIn.makeAttempt();
    const other = yield* SignIn.makeAttempt();
    assert.notEqual(attempt.state, other.state);
    const url = new URL(
      SignIn.authorizationUrl({
        server,
        clientId: "client-1",
        redirectUri: "http://127.0.0.1:3774/oauth/connections/callback",
        state: attempt.state,
        challenge: attempt.challenge,
      }),
    );
    assert.equal(url.origin + url.pathname, `${ISSUER}/authorize`);
    assert.equal(url.searchParams.get("state"), attempt.state);
    assert.equal(url.searchParams.get("resource"), RESOURCE);
    assert.equal(url.searchParams.get("scope"), "mcp offline_access");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), attempt.challenge);
    assert.notEqual(attempt.challenge, attempt.verifier);
    assert.isFalse(url.toString().includes(attempt.verifier));
  }).pipe(Effect.provide(NodeCrypto.layer)),
);

it("accepts a callback only from the server the sign-in was sent to", () => {
  assert.isTrue(SignIn.callbackIssuerMatches(server, ISSUER));
  assert.isFalse(SignIn.callbackIssuerMatches(server, "https://evil.example"));
  assert.isFalse(SignIn.callbackIssuerMatches(server, null));
  assert.isTrue(SignIn.callbackIssuerMatches({ ...server, namesItselfInCallback: false }, null));
});

it.effect("trades the code for a token, and keeps the refresh token an app does not replace", () =>
  Effect.gen(function* () {
    const http = fakeHttp((sent) => {
      const form = new URLSearchParams(sent.body);
      return form.get("grant_type") === "authorization_code"
        ? { body: { access_token: "a1", refresh_token: "r1", expires_in: 3600 } }
        : { body: { access_token: "a2", expires_in: 60 } };
    });
    const first = yield* withHttp(
      http,
      SignIn.exchange({
        server,
        clientId: "client-1",
        redirectUri: "http://127.0.0.1:3774/oauth/connections/callback",
        code: "code-1",
        verifier: "verifier-1",
        now: 1_000,
      }),
    );
    assert.deepEqual(first, { accessToken: "a1", refreshToken: "r1", expiresAt: 3_601_000 });
    const sent = new URLSearchParams(http.requests[0]!.body);
    assert.equal(sent.get("code_verifier"), "verifier-1");
    assert.equal(sent.get("resource"), RESOURCE);

    const renewed = yield* withHttp(
      http,
      SignIn.refresh({ server, clientId: "client-1", refreshToken: "r1", now: 2_000 }),
    );
    assert.deepEqual(renewed, { accessToken: "a2", refreshToken: "r1", expiresAt: 62_000 });
  }),
);

it.effect("tells a sign-in that is gone for good from one that failed this time", () =>
  Effect.gen(function* () {
    const refreshWith = (reply: FakeReply) =>
      withHttp(
        fakeHttp(() => reply),
        SignIn.refresh({ server, clientId: "client-1", refreshToken: "r1", now: 0 }),
      ).pipe(
        Effect.flip,
        Effect.map((error) => error.needsSignIn),
      );
    assert.isTrue(yield* refreshWith({ status: 400, body: { error: "invalid_grant" } }));
    assert.isFalse(yield* refreshWith({ status: 503, body: { error: "temporarily_unavailable" } }));
    assert.isFalse(yield* refreshWith({ status: 502, bytes: new TextEncoder().encode("<html>") }));
  }),
);

it.effect("revokes the refresh token where the app offers that", () =>
  Effect.gen(function* () {
    const http = fakeHttp(() => ({ status: 200, body: {} }));
    const tokens = { accessToken: "a1", refreshToken: "r1", expiresAt: null };
    yield* withHttp(http, SignIn.revoke({ server, clientId: "client-1", tokens }));
    yield* withHttp(
      http,
      SignIn.revoke({ server: { ...server, revocationEndpoint: null }, clientId: "c", tokens }),
    );
    assert.equal(http.requests.length, 1);
    assert.equal(new URLSearchParams(http.requests[0]!.body).get("token"), "r1");
  }),
);
