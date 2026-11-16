/**
 * How the owner's computer talks to the server it is setting up, over the Tailscale network:
 * it spends the setup secret for an owner session, then sends the notes and asks for what the
 * app and phone need to connect.
 */

import {
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
  ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";

import { ReceivedVault, ReceiverRoutines } from "./MajordomeMoveReceiver.ts";
import { MOVE_GITHUB_TOKEN_PATH, MOVE_ROUTINES_PATH, MOVE_VAULT_PATH } from "./moveReceiverHttp.ts";

const REQUEST_TIMEOUT = Duration.seconds(30);
const TRANSFER_TIMEOUT = Duration.minutes(30);
const PROBE_TIMEOUT = Duration.seconds(8);

/** `detail` is the server's own sentence for a refusal. There is no `cause`: requests hold tokens. */
export class MoveRemoteError extends Schema.TaggedError<MoveRemoteError>()("MoveRemoteError", {
  reason: Schema.Literals(["unreachable", "signed-out", "refused", "failed"]),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    switch (this.reason) {
      case "unreachable":
        return "Could not reach the new server over Tailscale.";
      case "signed-out":
        return "The new server no longer accepts this computer's connection.";
      case "refused":
        return this.detail ?? "The new server refused the request.";
      case "failed":
        return "The new server could not do that.";
    }
  }
}

const Refusal = Schema.Struct({ message: Schema.optional(Schema.String) });
const decodeRefusal = Schema.decodeUnknownOption(Refusal);

const AccessToken = Schema.Struct({ access_token: Schema.String });
const SessionState = Schema.Struct({ authenticated: Schema.Boolean });
const PairingCredential = Schema.Struct({
  credential: Schema.String,
  expiresAt: Schema.optional(Schema.Unknown),
});

const execute = Effect.fn("majordome.moveRemote.execute")(function* (
  request: HttpClientRequest.HttpClientRequest,
  timeout: Duration.Duration = REQUEST_TIMEOUT,
) {
  const http = yield* HttpClient.HttpClient;
  const response = yield* http.execute(request).pipe(
    // A redirect could forward the session token to another address.
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    Effect.timeout(timeout),
    // The failed request carries a secret or token, so it is not kept as the cause.
    Effect.mapError(() => new MoveRemoteError({ reason: "unreachable" })),
  );
  if (response.status >= 200 && response.status < 300) return response;
  // Tailscale answers for a server that is off or still starting with a gateway error.
  if (response.status >= 502 && response.status <= 504) {
    return yield* new MoveRemoteError({ reason: "unreachable" });
  }
  if (response.status === 401 || response.status === 403) {
    return yield* new MoveRemoteError({ reason: "signed-out" });
  }
  if (response.status === 409) {
    const body: unknown = yield* response.json.pipe(Effect.orElseSucceed(() => ({})));
    const detail = Option.getOrUndefined(decodeRefusal(body))?.message?.slice(0, 300);
    return yield* new MoveRemoteError({
      reason: "refused",
      ...(detail === undefined ? {} : { detail }),
    });
  }
  return yield* new MoveRemoteError({ reason: "failed" });
});

const json = <S extends Schema.Decoder<unknown>>(
  schema: S,
  response: HttpClientResponse.HttpClientResponse,
) =>
  response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    // An answer can hold a session token or pairing code, so the parse error is not kept.
    Effect.mapError(() => new MoveRemoteError({ reason: "failed" })),
  );

const authorized = (token: string) => HttpClientRequest.bearerToken(token);

/** The Majordome answering at `url`, or none while nothing does. Never fails. */
export const fetchEnvironment = Effect.fn("majordome.moveRemote.fetchEnvironment")(
  function* (url: string) {
    const response = yield* execute(
      HttpClientRequest.get(new URL("/.well-known/t3/environment", url)),
      PROBE_TIMEOUT,
    );
    const descriptor = yield* json(ExecutionEnvironmentDescriptor, response);
    return Option.some({ environmentId: descriptor.environmentId, label: descriptor.label });
  },
  Effect.orElseSucceed(() => Option.none()),
);

/** Spends the server's one-time setup secret for an owner session token. */
export const redeemSetupSecret = Effect.fn("majordome.moveRemote.redeemSetupSecret")(function* (
  url: string,
  input: { readonly secret: string; readonly label: string },
) {
  const response = yield* execute(
    HttpClientRequest.post(new URL("/oauth/token", url)).pipe(
      HttpClientRequest.bodyUrlParams({
        grant_type: AuthTokenExchangeGrantType,
        subject_token: input.secret,
        subject_token_type: AuthEnvironmentBootstrapTokenType,
        requested_token_type: AuthAccessTokenType,
        client_label: input.label,
      }),
    ),
  ).pipe(
    // The server answers a spent, expired or unknown secret with a 4xx.
    Effect.mapError((error) =>
      error.reason === "unreachable" ? error : new MoveRemoteError({ reason: "signed-out" }),
    ),
  );
  return (yield* json(AccessToken, response)).access_token;
});

/** True while the server still accepts the session. */
export const sessionWorks = (url: string, token: string) =>
  execute(HttpClientRequest.get(new URL("/api/auth/session", url)).pipe(authorized(token))).pipe(
    Effect.flatMap((response) => json(SessionState, response)),
    Effect.map((state) => state.authenticated),
    Effect.orElseSucceed(() => false),
  );

/** A one-time code that adds the server to whichever app or phone opens its link. */
export const issuePairingCredential = Effect.fn("majordome.moveRemote.issuePairingCredential")(
  function* (url: string, token: string, label: string) {
    const response = yield* execute(
      HttpClientRequest.post(new URL("/api/auth/pairing-token", url)).pipe(
        authorized(token),
        HttpClientRequest.bodyJsonUnsafe({ label }),
      ),
    );
    return yield* json(PairingCredential, response);
  },
);

export interface UploadVaultInput {
  readonly bundlePath: string;
  readonly title: string;
  readonly remote?: { readonly name: string; readonly url: string };
  readonly identity?: { readonly name: string; readonly email: string };
}

export const uploadVault = Effect.fn("majordome.moveRemote.uploadVault")(function* (
  url: string,
  token: string,
  input: UploadVaultInput,
) {
  const request = yield* HttpClientRequest.post(new URL(MOVE_VAULT_PATH, url)).pipe(
    authorized(token),
    HttpClientRequest.setUrlParams({
      title: input.title,
      ...(input.remote === undefined
        ? {}
        : { remote_name: input.remote.name, remote_url: input.remote.url }),
      ...(input.identity === undefined
        ? {}
        : { user_name: input.identity.name, user_email: input.identity.email }),
    }),
    HttpClientRequest.bodyFile(input.bundlePath, { contentType: "application/octet-stream" }),
    Effect.mapError(() => new MoveRemoteError({ reason: "failed" })),
  );
  return yield* json(ReceivedVault, yield* execute(request, TRANSFER_TIMEOUT));
});

/** Writes the server's notes, as a git bundle, to `targetPath`. */
export const downloadVault = Effect.fn("majordome.moveRemote.downloadVault")(function* (
  url: string,
  token: string,
  targetPath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const response = yield* execute(
    HttpClientRequest.get(new URL(MOVE_VAULT_PATH, url)).pipe(authorized(token)),
    TRANSFER_TIMEOUT,
  );
  yield* Stream.run(response.stream, fileSystem.sink(targetPath)).pipe(
    Effect.timeout(TRANSFER_TIMEOUT),
    Effect.mapError(() => new MoveRemoteError({ reason: "unreachable" })),
  );
});

export const sendGitHubToken = (url: string, token: string, githubToken: string) =>
  execute(
    HttpClientRequest.post(new URL(MOVE_GITHUB_TOKEN_PATH, url)).pipe(
      authorized(token),
      HttpClientRequest.bodyJsonUnsafe({ token: githubToken }),
    ),
  ).pipe(Effect.asVoid);

export const readRoutines = (url: string, token: string) =>
  execute(HttpClientRequest.get(new URL(MOVE_ROUTINES_PATH, url)).pipe(authorized(token))).pipe(
    Effect.flatMap((response) => json(ReceiverRoutines, response)),
  );

export const runRoutinesThere = (url: string, token: string) =>
  execute(HttpClientRequest.post(new URL(MOVE_ROUTINES_PATH, url)).pipe(authorized(token))).pipe(
    Effect.asVoid,
  );
