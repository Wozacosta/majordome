/**
 * How one of the owner's machines talks to another to keep the notes in step, over their private
 * network: it holds an owner session there, asks for what is new and sends its own.
 */

import { AuthAccessWriteScope } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { redeemSetupSecret } from "./moveRemote.ts";

export const PEER_VAULT_PATH = "/api/majordome/sync/vault";
/** The commit the answering machine is at, on every answer to a request for what is new. */
export const PEER_HEAD_HEADER = "x-majordome-head";

const REQUEST_TIMEOUT = Duration.seconds(30);
const TRANSFER_TIMEOUT = Duration.minutes(10);

/** `detail` is the other machine's own sentence. There is no `cause`: requests hold tokens. */
export class PeerRemoteError extends Schema.TaggedError<PeerRemoteError>()("PeerRemoteError", {
  reason: Schema.Literals(["unreachable", "signed-out", "outdated", "moved", "refused", "failed"]),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return this.detail ?? `The other machine could not keep the notes in step (${this.reason}).`;
  }
}

/** What the other machine says when it refuses; `reason` is absent from anything else's 404. */
const Refusal = Schema.Struct({
  reason: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});
const decodeRefusal = Schema.decodeUnknownOption(Refusal);
const Accepted = Schema.Struct({ head: Schema.String });
const PairingCredential = Schema.Struct({ credential: Schema.String });

const execute = Effect.fn("majordome.peerRemote.execute")(function* (
  request: HttpClientRequest.HttpClientRequest,
  timeout: Duration.Duration = REQUEST_TIMEOUT,
) {
  const http = yield* HttpClient.HttpClient;
  const response = yield* http.execute(request).pipe(
    // A redirect could forward the session token to another address.
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    Effect.timeout(timeout),
    // The failed request carries a token, so it is not kept as the cause.
    Effect.mapError(() => new PeerRemoteError({ reason: "unreachable" })),
  );
  const { status } = response;
  if (status >= 200 && status < 300) return response;
  // Tailscale answers for a machine that is off or still starting with a gateway error.
  if (status >= 502 && status <= 504) return yield* new PeerRemoteError({ reason: "unreachable" });
  if (status === 401 || status === 403) return yield* new PeerRemoteError({ reason: "signed-out" });
  const body: unknown = yield* response.json.pipe(Effect.orElseSucceed(() => ({})));
  const refusal = Option.getOrUndefined(decodeRefusal(body));
  // An older Majordome has no such address and answers without a reason of ours.
  if (refusal?.reason === undefined) {
    return yield* new PeerRemoteError({
      reason: status === 404 || status === 405 ? "outdated" : "failed",
    });
  }
  if (refusal.reason === "moved") return yield* new PeerRemoteError({ reason: "moved" });
  const detail = refusal.message?.slice(0, 300);
  return yield* new PeerRemoteError({
    reason: refusal.reason === "failed" ? "failed" : "refused",
    ...(detail === undefined ? {} : { detail }),
  });
});

/** Spends a one-time pairing credential for a session on the other machine. */
export const openPeerSession = (
  url: string,
  input: { readonly credential: string; readonly label: string },
) =>
  redeemSetupSecret(url, { secret: input.credential, label: input.label }).pipe(
    Effect.mapError((error) => new PeerRemoteError({ reason: error.reason })),
  );

/** A new session from one that still works, with only the access the sync needs. */
export const renewPeerSession = Effect.fn("majordome.peerRemote.renewSession")(function* (
  url: string,
  token: string,
  label: string,
) {
  const response = yield* execute(
    HttpClientRequest.post(new URL("/api/auth/pairing-token", url)).pipe(
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.bodyJsonUnsafe({ label, scopes: [AuthAccessWriteScope] }),
    ),
  );
  const { credential } = yield* response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PairingCredential)),
    // The answer holds a pairing credential, so the parse error is not kept.
    Effect.mapError(() => new PeerRemoteError({ reason: "failed" })),
  );
  return yield* openPeerSession(url, { credential, label });
});

export interface PeerRequest {
  readonly url: string;
  readonly token: string;
  readonly brainId: string;
  /** This machine's name and id, so the other one can say who it is in step with. */
  readonly from: { readonly label: string; readonly environmentId: string };
}

const peerRequest = (
  method: "GET" | "POST" | "DELETE",
  input: PeerRequest,
  extra: Record<string, string>,
) =>
  HttpClientRequest.make(method)(new URL(PEER_VAULT_PATH, input.url)).pipe(
    HttpClientRequest.bearerToken(input.token),
    HttpClientRequest.setUrlParams({
      brain: input.brainId,
      from: input.from.label,
      from_id: input.from.environmentId,
      ...extra,
    }),
  );

/**
 * Writes what the other machine has beyond `have`, as a git bundle, to `targetPath`. `arrived` is
 * false when it has nothing new; `head` is the commit it is at.
 */
export const fetchPeerNews = Effect.fn("majordome.peerRemote.fetchNews")(function* (
  input: PeerRequest & { readonly have: string | null; readonly targetPath: string },
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const response = yield* execute(
    peerRequest("GET", input, input.have === null ? {} : { have: input.have }),
    TRANSFER_TIMEOUT,
  );
  const head = response.headers[PEER_HEAD_HEADER];
  // An older Majordome answers any unknown address with the app's page.
  if (head === undefined || !/^[0-9a-f]{40,64}$/.test(head)) {
    return yield* new PeerRemoteError({ reason: "outdated" });
  }
  if (response.status === 204) return { arrived: false, head };
  yield* Stream.run(response.stream, fileSystem.sink(input.targetPath)).pipe(
    Effect.timeout(TRANSFER_TIMEOUT),
    Effect.mapError(() => new PeerRemoteError({ reason: "unreachable" })),
  );
  return { arrived: true, head };
});

/** Tells the other machine this one no longer keeps these notes in step with it. */
export const sendPeerGoodbye = Effect.fn("majordome.peerRemote.sendGoodbye")(function* (
  input: PeerRequest,
) {
  yield* execute(peerRequest("DELETE", input, {}));
});

/** Sends this machine's new changes; answers with the commit the other machine is at now. */
export const sendPeerNews = Effect.fn("majordome.peerRemote.sendNews")(function* (
  input: PeerRequest & { readonly bundlePath: string; readonly theyReplay: boolean },
) {
  const request = yield* peerRequest("POST", input, input.theyReplay ? { replay: "1" } : {}).pipe(
    HttpClientRequest.bodyFile(input.bundlePath, { contentType: "application/octet-stream" }),
    Effect.mapError(() => new PeerRemoteError({ reason: "failed" })),
  );
  const response = yield* execute(request, TRANSFER_TIMEOUT);
  return yield* response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Accepted)),
    Effect.mapError(() => new PeerRemoteError({ reason: "outdated" })),
  );
});
