/**
 * This server's Google Drive sign-in: one per server, like the GitHub one. The refresh token lives
 * in the server's secret store; access tokens are kept in memory and renewed when due.
 */

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  type GoogleClient,
  GoogleDriveError,
  pollGoogleDeviceToken,
  refreshGoogleAccessToken,
  requestGoogleDeviceCode,
  resolveGoogleClient,
  revokeGoogleToken,
} from "./googleDriveApi.ts";

// Release builds bake in the OAuth app (apps/server/vite.config.ts); the environment overrides it.
declare const __MAJORDOME_BUILD_GOOGLE_CLIENT_ID__: string | undefined;
declare const __MAJORDOME_BUILD_GOOGLE_CLIENT_SECRET__: string | undefined;
const BUILD_GOOGLE_CLIENT: GoogleClient = {
  clientId:
    typeof __MAJORDOME_BUILD_GOOGLE_CLIENT_ID__ === "undefined"
      ? ""
      : __MAJORDOME_BUILD_GOOGLE_CLIENT_ID__,
  clientSecret:
    typeof __MAJORDOME_BUILD_GOOGLE_CLIENT_SECRET__ === "undefined"
      ? ""
      : __MAJORDOME_BUILD_GOOGLE_CLIENT_SECRET__,
};

const REFRESH_TOKEN_SECRET = "majordome-google-refresh-token";
// Renew ahead of expiry so a token never lapses in the middle of an upload's first request.
const RENEW_MARGIN_MS = 5 * 60 * 1_000;

export type GoogleSignInPrompt =
  | { readonly status: "signed-in" }
  | {
      readonly status: "code";
      readonly userCode: string;
      readonly verificationUrl: string;
      readonly expiresAt: number;
    };

export class GoogleDriveAuth extends Context.Service<
  GoogleDriveAuth,
  {
    readonly available: boolean;
    readonly signedIn: Effect.Effect<boolean>;
    readonly start: () => Effect.Effect<GoogleSignInPrompt, GoogleDriveError>;
    /** Resolves once the sign-in `start` began has saved a refresh token. */
    readonly wait: () => Effect.Effect<void, GoogleDriveError>;
    readonly cancel: () => Effect.Effect<void>;
    /** A current access token; fails `signed-out` when Google no longer accepts the sign-in. */
    readonly accessToken: () => Effect.Effect<string, GoogleDriveError>;
    /** Drops a cached access token Drive just refused, so the next call renews it. */
    readonly invalidate: () => Effect.Effect<void>;
    /** Revokes the sign-in at Google and forgets it here. */
    readonly disconnect: () => Effect.Effect<void, GoogleDriveError>;
  }
>()("t3/majordome/GoogleDriveAuth") {}

interface PendingSignIn {
  readonly deferred: Deferred.Deferred<void, GoogleDriveError>;
  readonly fiber: Fiber.Fiber<unknown, unknown>;
}

const storeError = (cause: unknown) =>
  new GoogleDriveError({
    reason: "failed",
    message: "The server could not use its secret store for the Google sign-in.",
    cause,
  });

export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const services = yield* Effect.context<HttpClient.HttpClient>();
  const environment = yield* HostProcess.Environment;
  const client = resolveGoogleClient(environment, BUILD_GOOGLE_CLIENT);
  const layerScope = yield* Effect.scope;
  const cached = yield* Ref.make<{ readonly token: string; readonly expiresAt: number } | null>(
    null,
  );
  const renewLock = yield* Semaphore.make(1);
  const pending = yield* Ref.make<PendingSignIn | null>(null);

  const readRefreshToken = secrets
    .get(REFRESH_TOKEN_SECRET)
    .pipe(
      Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes))),
      Effect.mapError(storeError),
    );

  const signedIn: GoogleDriveAuth["Service"]["signedIn"] = readRefreshToken.pipe(
    Effect.map(Option.isSome),
    Effect.orElseSucceed(() => false),
  );

  const isFresh = (entry: { readonly expiresAt: number } | null, now: number) =>
    entry !== null && now < entry.expiresAt - RENEW_MARGIN_MS;

  const accessToken: GoogleDriveAuth["Service"]["accessToken"] = Effect.fn(
    "GoogleDriveAuth.accessToken",
  )(function* () {
    const current = yield* Ref.get(cached);
    if (current !== null && isFresh(current, yield* Clock.currentTimeMillis)) return current.token;
    return yield* renewLock.withPermits(1)(
      Effect.gen(function* () {
        const again = yield* Ref.get(cached);
        if (again !== null && isFresh(again, yield* Clock.currentTimeMillis)) return again.token;
        const refreshToken = yield* readRefreshToken;
        if (Option.isNone(refreshToken)) {
          return yield* new GoogleDriveError({
            reason: "signed-out",
            message: "Google Drive isn't connected on this computer. Connect it again.",
          });
        }
        const renewed = yield* refreshGoogleAccessToken({
          client,
          refreshToken: refreshToken.value,
        }).pipe(Effect.provide(services));
        yield* Ref.set(cached, { token: renewed.accessToken, expiresAt: renewed.expiresAt });
        return renewed.accessToken;
      }),
    );
  });

  const invalidate: GoogleDriveAuth["Service"]["invalidate"] = Effect.fn(
    "GoogleDriveAuth.invalidate",
  )(function* () {
    yield* Ref.set(cached, null);
  });

  const start: GoogleDriveAuth["Service"]["start"] = Effect.fn("GoogleDriveAuth.start")(
    function* () {
      if (client.clientId === "" || client.clientSecret === "") {
        return yield* new GoogleDriveError({
          reason: "failed",
          message: "Google Drive backup isn't set up on this server yet.",
        });
      }
      if (Option.isSome(yield* readRefreshToken)) {
        const deferred = yield* Deferred.make<void, GoogleDriveError>();
        yield* Deferred.succeed(deferred, undefined);
        const fiber = yield* Effect.forkIn(Effect.void, layerScope);
        yield* Ref.set(pending, { deferred, fiber });
        return { status: "signed-in" } as GoogleSignInPrompt;
      }
      const code = yield* requestGoogleDeviceCode(client).pipe(Effect.provide(services));
      const deferred = yield* Deferred.make<void, GoogleDriveError>();
      const fiber = yield* pollGoogleDeviceToken({ client, code }).pipe(
        Effect.provide(services),
        Effect.flatMap((tokens) =>
          secrets
            .set(REFRESH_TOKEN_SECRET, new TextEncoder().encode(tokens.refreshToken))
            .pipe(
              Effect.mapError(storeError),
              Effect.andThen(
                Ref.set(cached, { token: tokens.accessToken, expiresAt: tokens.expiresAt }),
              ),
            ),
        ),
        Deferred.into(deferred),
        Effect.forkIn(layerScope),
      );
      const previous = yield* Ref.getAndSet(pending, { deferred, fiber });
      if (previous !== null) {
        yield* Deferred.fail(
          previous.deferred,
          new GoogleDriveError({ reason: "failed", message: "A newer sign-in replaced this one." }),
        );
        yield* Fiber.interrupt(previous.fiber);
      }
      return {
        status: "code",
        userCode: code.userCode,
        verificationUrl: code.verificationUrl,
        expiresAt: code.expiresAt,
      } as GoogleSignInPrompt;
    },
  );

  const wait: GoogleDriveAuth["Service"]["wait"] = Effect.fn("GoogleDriveAuth.wait")(function* () {
    const current = yield* Ref.get(pending);
    if (current === null) {
      return yield* new GoogleDriveError({
        reason: "failed",
        message: "No Google sign-in is in progress. Start again.",
      });
    }
    return yield* Deferred.await(current.deferred);
  });

  const cancel: GoogleDriveAuth["Service"]["cancel"] = Effect.fn("GoogleDriveAuth.cancel")(
    function* () {
      const current = yield* Ref.getAndSet(pending, null);
      if (current === null) return;
      yield* Deferred.fail(
        current.deferred,
        new GoogleDriveError({ reason: "failed", message: "The Google sign-in was cancelled." }),
      );
      yield* Fiber.interrupt(current.fiber);
    },
  );

  const disconnect: GoogleDriveAuth["Service"]["disconnect"] = Effect.fn(
    "GoogleDriveAuth.disconnect",
  )(function* () {
    const refreshToken = yield* readRefreshToken;
    if (Option.isSome(refreshToken)) {
      yield* revokeGoogleToken(refreshToken.value).pipe(Effect.provide(services));
    }
    yield* secrets.remove(REFRESH_TOKEN_SECRET).pipe(Effect.mapError(storeError));
    yield* Ref.set(cached, null);
  });

  return GoogleDriveAuth.of({
    available: client.clientId !== "",
    signedIn,
    start,
    wait,
    cancel,
    accessToken,
    invalidate,
    disconnect,
  });
});

export const layer = Layer.effect(GoogleDriveAuth, make);
