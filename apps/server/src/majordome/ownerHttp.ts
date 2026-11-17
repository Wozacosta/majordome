/** The guard for routes only an owner session may call: one of the owner's machines, not a guest. */

import { AuthAccessWriteScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import type * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";

/**
 * Runs `handle` for a session able to grant access; anyone else gets 401 or 403 and nothing
 * happens. `failure` is the log line for a handler that broke.
 */
export const makeOwnerGuard = (
  auth: EnvironmentAuth.EnvironmentAuth["Service"],
  options: { readonly span: string; readonly failure: string },
) =>
  Effect.fn(options.span)(function* <E, R>(
    handle: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const session = yield* auth.authenticateHttpRequest(request).pipe(Effect.result);
    if (session._tag === "Failure") return HttpServerResponse.empty({ status: 401 });
    if (!session.success.scopes.includes(AuthAccessWriteScope)) {
      return HttpServerResponse.empty({ status: 403 });
    }
    return yield* handle(request).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(options.failure, { cause }).pipe(
          Effect.as(HttpServerResponse.empty({ status: 500 })),
        ),
      ),
    );
  });
