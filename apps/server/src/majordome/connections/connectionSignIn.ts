/**
 * The sign-in to an app's MCP server, as the MCP authorization spec describes it: find the
 * app's sign-in server, register as a client, send the owner to approve, trade the code for a
 * token, and renew or revoke it later. Every address after the first comes from the app, so
 * callers provide an `HttpClient` that only reaches public addresses.
 */

import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

const REQUEST_TIMEOUT = "15 seconds";
const CLIENT_NAME = "Majordome";

export class ConnectionSignInError extends Schema.TaggedError<ConnectionSignInError>()(
  "ConnectionSignInError",
  {
    step: Schema.Literals(["discover", "register", "exchange", "refresh"]),
    /** Plain words, safe to show: never the app's own error text, which is not ours to trust. */
    detail: Schema.String,
    /** The app no longer knows the client or the token, so a new sign-in is the only way on. */
    needsSignIn: Schema.Boolean,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const ProtectedResource = Schema.Struct({
  resource: Schema.optional(Schema.String),
  authorization_servers: Schema.optional(Schema.Array(Schema.String)),
  scopes_supported: Schema.optional(Schema.Array(Schema.String)),
});

const AuthorizationServer = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  registration_endpoint: Schema.optional(Schema.String),
  revocation_endpoint: Schema.optional(Schema.String),
  scopes_supported: Schema.optional(Schema.Array(Schema.String)),
  code_challenge_methods_supported: Schema.optional(Schema.Array(Schema.String)),
  authorization_response_iss_parameter_supported: Schema.optional(Schema.Boolean),
});

const Registration = Schema.Struct({ client_id: Schema.String });

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
});

const TokenRefusal = Schema.Struct({ error: Schema.String });

const decodeProtectedResource = Schema.decodeUnknownOption(ProtectedResource);
const decodeAuthorizationServer = Schema.decodeUnknownOption(AuthorizationServer);
const decodeRegistration = Schema.decodeUnknownOption(Registration);
const decodeToken = Schema.decodeUnknownOption(TokenResponse);
const decodeRefusal = Schema.decodeUnknownOption(TokenRefusal);

/** Where an app is signed in to, read once when the connection is made and kept with it. */
export interface SignInServer {
  /** The app's MCP address, sent as `resource` so the token is only good there. */
  readonly resource: string;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string;
  readonly revocationEndpoint: string | null;
  readonly scope: string | null;
  /** The app says who answered in the callback, so the answer can be checked against `issuer`. */
  readonly namesItselfInCallback: boolean;
}

export interface ConnectionTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Epoch milliseconds; null when the app does not say. */
  readonly expiresAt: number | null;
}

const isHttps = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** RFC 8414 and 9728 put the document under `/.well-known/<name>` followed by the path. */
function wellKnown(base: string, name: string): ReadonlyArray<string> {
  const url = new URL(base);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return [
    ...new Set([`${url.origin}/.well-known/${name}${path}`, `${url.origin}/.well-known/${name}`]),
  ];
}

const getJson = Effect.fn("connectionSignIn.getJson")(function* (url: string) {
  const http = yield* HttpClient.HttpClient;
  return yield* http
    .execute(
      HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders({ accept: "application/json" })),
    )
    .pipe(
      Effect.flatMap((response) =>
        response.status === 200 ? response.json : Effect.succeed(undefined),
      ),
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.orElseSucceed(() => undefined),
    );
});

const firstDocument = Effect.fn("connectionSignIn.firstDocument")(function* <A>(
  urls: ReadonlyArray<string>,
  decode: (value: unknown) => Option.Option<A>,
) {
  for (const url of urls) {
    const found = decode(yield* getJson(url));
    if (Option.isSome(found)) return found;
  }
  return Option.none<A>();
});

const discoverFailed = (detail: string) =>
  new ConnectionSignInError({ step: "discover", detail, needsSignIn: false });

/**
 * Reads the app's two sign-in documents and checks they agree with what was asked for: the
 * first names this very address, the second names the server it was fetched from.
 */
export const discover = Effect.fn("connectionSignIn.discover")(function* (resource: string) {
  const protectedResource = yield* firstDocument(
    wellKnown(resource, "oauth-protected-resource"),
    decodeProtectedResource,
  );
  if (Option.isNone(protectedResource)) {
    return yield* discoverFailed("This app does not say where to sign in.");
  }
  const named = protectedResource.value.resource;
  if (named !== undefined && named.replace(/\/$/, "") !== resource.replace(/\/$/, "")) {
    return yield* discoverFailed("This app's sign-in details are for another address.");
  }
  const issuer = protectedResource.value.authorization_servers?.[0];
  if (issuer === undefined || !isHttps(issuer)) {
    return yield* discoverFailed("This app does not say where to sign in.");
  }
  const server = yield* firstDocument(
    [
      ...wellKnown(issuer, "oauth-authorization-server"),
      ...wellKnown(issuer, "openid-configuration"),
    ],
    decodeAuthorizationServer,
  );
  if (Option.isNone(server)) {
    return yield* discoverFailed("This app's sign-in server could not be read.");
  }
  const found = server.value;
  if (found.issuer.replace(/\/$/, "") !== issuer.replace(/\/$/, "")) {
    return yield* discoverFailed("This app's sign-in server gives another name than its own.");
  }
  if (found.code_challenge_methods_supported?.includes("S256") !== true) {
    return yield* discoverFailed("This app's sign-in is not safe enough to use.");
  }
  if (found.registration_endpoint === undefined) {
    return yield* discoverFailed("This app only accepts programs it has approved by hand.");
  }
  const endpoints = [
    found.authorization_endpoint,
    found.token_endpoint,
    found.registration_endpoint,
    ...(found.revocation_endpoint === undefined ? [] : [found.revocation_endpoint]),
  ];
  if (!endpoints.every(isHttps)) {
    return yield* discoverFailed("This app's sign-in is not safe enough to use.");
  }
  const wanted = protectedResource.value.scopes_supported ?? [];
  // Staying signed in is asked for where the app lists it, on either document.
  const offline = [...wanted, ...(found.scopes_supported ?? [])].includes("offline_access");
  const scopes = [...new Set([...wanted, ...(offline ? ["offline_access"] : [])])];
  return {
    resource,
    issuer: found.issuer,
    authorizationEndpoint: found.authorization_endpoint,
    tokenEndpoint: found.token_endpoint,
    registrationEndpoint: found.registration_endpoint,
    revocationEndpoint: found.revocation_endpoint ?? null,
    scope: scopes.length === 0 ? null : scopes.join(" "),
    namesItselfInCallback: found.authorization_response_iss_parameter_supported === true,
  } satisfies SignInServer;
});

const postJson = Effect.fn("connectionSignIn.postJson")(function* (
  request: HttpClientRequest.HttpClientRequest,
) {
  const http = yield* HttpClient.HttpClient;
  return yield* http.execute(request).pipe(
    Effect.flatMap((response) =>
      response.json.pipe(
        Effect.orElseSucceed((): unknown => undefined),
        Effect.map((body) => ({ status: response.status, body })),
      ),
    ),
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.orElseSucceed(() => ({ status: 0, body: undefined as unknown })),
  );
});

/**
 * Registers Majordome with the app for one callback address. A loopback address registers as
 * a native program and any other as a web one, which is what decides the addresses an app allows.
 */
export const register = Effect.fn("connectionSignIn.register")(function* (
  server: Pick<SignInServer, "registrationEndpoint">,
  redirectUri: string,
) {
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(redirectUri).hostname);
  const answer = yield* postJson(
    HttpClientRequest.post(server.registrationEndpoint).pipe(
      HttpClientRequest.setHeaders({ accept: "application/json" }),
      HttpClientRequest.bodyJsonUnsafe({
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: loopback ? "native" : "web",
      }),
    ),
  );
  const registered = decodeRegistration(answer.body);
  if (answer.status < 200 || answer.status >= 300 || Option.isNone(registered)) {
    return yield* new ConnectionSignInError({
      step: "register",
      detail: "This app did not accept Majordome.",
      needsSignIn: false,
    });
  }
  return { clientId: registered.value.client_id };
});

const base64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/**
 * One attempt's secrets: `state` comes back in the callback, `verifier` goes with the code, and
 * `challenge` is what the app is shown of the verifier beforehand.
 */
export const makeAttempt = Effect.fn("connectionSignIn.makeAttempt")(function* () {
  const random = yield* SecureRandom.SecureRandom;
  const digester = yield* Digest.Digest;
  const verifier = base64Url(yield* random.randomBytes(32));
  return {
    state: base64Url(yield* random.randomBytes(24)),
    verifier,
    challenge: base64Url(
      yield* digester.digest(Digest.sha256, new TextEncoder().encode(verifier)).pipe(Effect.orDie),
    ),
  };
});

/** The page the owner approves on. */
export function authorizationUrl(input: {
  readonly server: SignInServer;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly challenge: string;
}): string {
  const url = new URL(input.server.authorizationEndpoint);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    resource: input.server.resource,
    ...(input.server.scope === null ? {} : { scope: input.server.scope }),
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** False when the app says who answered and it is not the server the sign-in was sent to. */
export function callbackIssuerMatches(server: SignInServer, issuer: string | null): boolean {
  if (issuer === null) return !server.namesItselfInCallback;
  return issuer.replace(/\/$/, "") === server.issuer.replace(/\/$/, "");
}

// What an app answers when the client or the grant is gone for good (RFC 6749 section 5.2).
const GONE = new Set(["invalid_grant", "invalid_client", "unauthorized_client"]);

const requestToken = Effect.fn("connectionSignIn.requestToken")(function* (
  step: "exchange" | "refresh",
  server: SignInServer,
  params: Record<string, string>,
  now: number,
) {
  const answer = yield* postJson(
    HttpClientRequest.post(server.tokenEndpoint).pipe(
      HttpClientRequest.setHeaders({ accept: "application/json" }),
      HttpClientRequest.bodyUrlParams({ ...params, resource: server.resource }),
    ),
  );
  const token = decodeToken(answer.body);
  if (answer.status === 200 && Option.isSome(token)) {
    return {
      accessToken: token.value.access_token,
      refreshToken: token.value.refresh_token ?? null,
      expiresAt: token.value.expires_in === undefined ? null : now + token.value.expires_in * 1000,
    } satisfies ConnectionTokens;
  }
  const refusal = Option.getOrUndefined(decodeRefusal(answer.body))?.error;
  return yield* new ConnectionSignInError({
    step,
    detail:
      step === "exchange"
        ? "The app did not finish the sign-in."
        : "The app did not renew the sign-in.",
    needsSignIn: refusal !== undefined && GONE.has(refusal),
  });
});

export const exchange = (input: {
  readonly server: SignInServer;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly verifier: string;
  readonly now: number;
}) =>
  requestToken(
    "exchange",
    input.server,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.verifier,
    },
    input.now,
  );

/**
 * Renews the token. Some apps hand out a new refresh token each time and retire the old one, so
 * the caller saves the answer before using it; an app that sends none keeps the one it had.
 */
export const refresh = (input: {
  readonly server: SignInServer;
  readonly clientId: string;
  readonly refreshToken: string;
  readonly now: number;
}) =>
  requestToken(
    "refresh",
    input.server,
    { grant_type: "refresh_token", refresh_token: input.refreshToken, client_id: input.clientId },
    input.now,
  ).pipe(
    Effect.map((tokens) => ({
      ...tokens,
      refreshToken: tokens.refreshToken ?? input.refreshToken,
    })),
  );

/** Tells the app to forget the token. Best effort: the token is deleted here either way. */
export const revoke = Effect.fn("connectionSignIn.revoke")(function* (input: {
  readonly server: SignInServer;
  readonly clientId: string;
  readonly tokens: ConnectionTokens;
}) {
  if (input.server.revocationEndpoint === null) return;
  const refreshToken = input.tokens.refreshToken;
  yield* postJson(
    HttpClientRequest.post(input.server.revocationEndpoint).pipe(
      HttpClientRequest.bodyUrlParams({
        token: refreshToken ?? input.tokens.accessToken,
        client_id: input.clientId,
        ...(refreshToken === null ? {} : { token_type_hint: "refresh_token" }),
      }),
    ),
  );
});
