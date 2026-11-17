/**
 * The routes one of the owner's machines calls on another to keep the notes in step. Both need an
 * owner session able to grant access, and both find the notes by which brain they are.
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { requestUrl } from "../requestUrl.ts";
import * as MajordomePeerSync from "./MajordomePeerSync.ts";
import { makeOwnerGuard } from "./ownerHttp.ts";
import { PEER_HEAD_HEADER, PEER_VAULT_PATH } from "./peerRemote.ts";

const REFUSAL_STATUS: Record<MajordomePeerSync.PeerSyncRefusal["reason"], number> = {
  "unknown-notes": 404,
  "other-notes": 409,
  moved: 409,
  failed: 500,
};

/** The answer for a refusal: its reason, which the asking machine acts on, and a plain sentence. */
export const peerRefusalAnswer = (error: MajordomePeerSync.PeerSyncRefusal) => ({
  status: REFUSAL_STATUS[error.reason],
  body: { reason: error.reason, message: error.message },
});

const refusal = (error: MajordomePeerSync.PeerSyncRefusal) => {
  const answer = peerRefusalAnswer(error);
  return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status });
};

/** What a request says about itself; null without the brain it is about. */
export const readPeerCall = (params: URLSearchParams | undefined) => {
  const text = (name: string) => params?.get(name)?.trim() || undefined;
  const brainId = text("brain");
  if (brainId === undefined) return null;
  const environmentId = text("from_id");
  return {
    brainId,
    have: text("have") ?? null,
    replay: text("replay") === "1",
    from: {
      label: text("from") ?? "Another machine",
      ...(environmentId === undefined ? {} : { environmentId }),
    },
  };
};

const callOf = (request: HttpServerRequest.HttpServerRequest) =>
  readPeerCall(Option.getOrUndefined(requestUrl(request))?.searchParams);

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const peers = yield* MajordomePeerSync.MajordomePeerSync;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const owner = makeOwnerGuard(auth, {
      span: "majordome.peerSync.owner",
      failure: "A request to keep notes in step failed.",
    });

    const offer = owner((request) =>
      Effect.gen(function* () {
        const call = callOf(request);
        if (call === null) return HttpServerResponse.empty({ status: 400 });
        // Not scoped: the response streams the file after the handler has returned.
        const temp = yield* fileSystem.makeTempDirectory({ prefix: "majordome-peer-out-" });
        const discard = fileSystem.remove(temp, { recursive: true, force: true }).pipe(Effect.ignore);
        const bundlePath = path.join(temp, "news.bundle");
        const packed = yield* peers.offer({ ...call, bundlePath }).pipe(Effect.result);
        if (packed._tag === "Failure") {
          yield* discard;
          return refusal(packed.failure);
        }
        const headers = { "cache-control": "no-store", [PEER_HEAD_HEADER]: packed.success.head };
        if (!packed.success.packed) {
          yield* discard;
          return HttpServerResponse.empty({ status: 204, headers });
        }
        const size = Number((yield* fileSystem.stat(bundlePath)).size);
        return HttpServerResponse.stream(
          fileSystem.stream(bundlePath).pipe(Stream.ensuring(discard)),
          {
            contentType: "application/octet-stream",
            contentLength: size,
            headers,
          },
        );
      }),
    );

    const accept = owner((request) =>
      Effect.gen(function* () {
        const call = callOf(request);
        if (call === null) return HttpServerResponse.empty({ status: 400 });
        const temp = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-peer-in-" });
        const bundlePath = path.join(temp, "news.bundle");
        yield* Stream.run(request.stream, fileSystem.sink(bundlePath));
        return yield* peers.accept({ ...call, bundlePath }).pipe(
          Effect.map((accepted) => HttpServerResponse.jsonUnsafe(accepted)),
          Effect.catch((error) => Effect.succeed(refusal(error))),
        );
      }).pipe(Effect.scoped),
    );

    return Layer.mergeAll(
      HttpRouter.add("GET", PEER_VAULT_PATH, offer),
      HttpRouter.add("POST", PEER_VAULT_PATH, accept),
    );
  }),
);
