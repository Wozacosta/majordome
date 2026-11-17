/**
 * The routes the owner's computer calls on a server it is setting up. Every one needs an owner
 * session able to grant access, which the computer gets by spending the server's setup secret.
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { requestUrl } from "../requestUrl.ts";
import * as MajordomeMoveReceiver from "./MajordomeMoveReceiver.ts";
import { makeOwnerGuard } from "./ownerHttp.ts";

export const MOVE_VAULT_PATH = "/api/majordome/move/vault";
export const MOVE_GITHUB_TOKEN_PATH = "/api/majordome/move/github-token";
export const MOVE_ROUTINES_PATH = "/api/majordome/move/routines";

const GitHubTokenBody = Schema.Struct({ token: Schema.String });

const refusal = (error: MajordomeMoveReceiver.MoveReceiverError) =>
  HttpServerResponse.jsonUnsafe(
    { reason: error.reason, message: error.message },
    { status: error.reason === "failed" ? 500 : 409 },
  );

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const receiver = yield* MajordomeMoveReceiver.MajordomeMoveReceiver;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    // Kept between requests: the response streams it after the handler has returned.
    const outgoingBundle = path.join(config.stateDir, "majordome", "outgoing.bundle");

    const owner = makeOwnerGuard(auth, {
      span: "majordome.moveReceiver.owner",
      failure: "A server move request failed.",
    });

    const receiveVault = owner((request) =>
      Effect.gen(function* () {
        const params = Option.getOrUndefined(requestUrl(request))?.searchParams;
        const text = (name: string) => params?.get(name)?.trim() || undefined;
        const temp = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-move-" });
        const bundlePath = path.join(temp, "vault.bundle");
        yield* Stream.run(request.stream, fileSystem.sink(bundlePath));
        const remoteName = text("remote_name");
        const remoteUrl = text("remote_url");
        const userName = text("user_name");
        const userEmail = text("user_email");
        return yield* receiver
          .receiveVault({
            bundlePath,
            title: text("title") ?? "Notes",
            ...(remoteName !== undefined && remoteUrl !== undefined
              ? { remote: { name: remoteName, url: remoteUrl } }
              : {}),
            ...(userName !== undefined && userEmail !== undefined
              ? { identity: { name: userName, email: userEmail } }
              : {}),
          })
          .pipe(
            Effect.map((received) => HttpServerResponse.jsonUnsafe(received)),
            Effect.catch((error) => Effect.succeed(refusal(error))),
          );
      }).pipe(Effect.scoped),
    );

    const sendVault = owner(() =>
      Effect.gen(function* () {
        yield* fileSystem.makeDirectory(path.dirname(outgoingBundle), { recursive: true });
        yield* fileSystem.remove(outgoingBundle, { force: true });
        const sent = yield* receiver.sendVault(outgoingBundle).pipe(Effect.result);
        if (sent._tag === "Failure") return refusal(sent.failure);
        return yield* HttpServerResponse.file(outgoingBundle, {
          contentType: "application/octet-stream",
          headers: { "cache-control": "no-store" },
        });
      }),
    );

    const setGitHubToken = owner((request) =>
      Effect.gen(function* () {
        const body = yield* HttpServerRequest.schemaBodyJson(GitHubTokenBody).pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
          Effect.option,
        );
        if (Option.isNone(body)) return HttpServerResponse.empty({ status: 400 });
        return yield* receiver.setGitHubToken(body.value.token).pipe(
          Effect.as(HttpServerResponse.empty({ status: 204 })),
          Effect.catch((error) => Effect.succeed(refusal(error))),
        );
      }),
    );

    const readRoutines = owner(() =>
      receiver.routines().pipe(
        Effect.map((routines) => HttpServerResponse.jsonUnsafe(routines)),
        Effect.catch((error) => Effect.succeed(refusal(error))),
      ),
    );

    const runRoutines = owner(() =>
      receiver.runRoutinesHere().pipe(
        Effect.as(HttpServerResponse.empty({ status: 204 })),
        Effect.catch((error) => Effect.succeed(refusal(error))),
      ),
    );

    return Layer.mergeAll(
      HttpRouter.add("POST", MOVE_VAULT_PATH, receiveVault),
      HttpRouter.add("GET", MOVE_VAULT_PATH, sendVault),
      HttpRouter.add("POST", MOVE_GITHUB_TOKEN_PATH, setGitHubToken),
      HttpRouter.add("GET", MOVE_ROUTINES_PATH, readRoutines),
      HttpRouter.add("POST", MOVE_ROUTINES_PATH, runRoutines),
    );
  }),
);
