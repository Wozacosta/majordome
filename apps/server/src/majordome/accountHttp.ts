/**
 * The one route a device with no session here may call to get in: it shows a token for the
 * account that owns this server and receives the credential a pairing link would carry.
 */

import {
  MAJORDOME_ACCOUNT_SIGN_IN_PATH,
  type MajordomeAccountError,
  MajordomeAccountSignIn,
  MajordomeAccountSignInInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as MajordomeAccount from "./MajordomeAccount.ts";

const REFUSAL_STATUS: Record<MajordomeAccountError["reason"], number> = {
  unavailable: 404,
  "invalid-token": 401,
  "used-token": 401,
  "wrong-key": 401,
  "not-owner": 403,
  fixed: 409,
  failed: 500,
};

const NO_STORE = { "cache-control": "no-store" } as const;
const encodeSignIn = Schema.encodeSync(MajordomeAccountSignIn);

/** The answer for a refusal: its reason, which the app acts on, and a plain sentence. */
const accountRefusalAnswer = (error: MajordomeAccountError) => ({
  status: REFUSAL_STATUS[error.reason],
  body: { reason: error.reason, message: error.message },
});

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const account = yield* MajordomeAccount.MajordomeAccount;

    const signIn = Effect.gen(function* () {
      const body = yield* HttpServerRequest.schemaBodyJson(MajordomeAccountSignInInput).pipe(
        Effect.option,
      );
      if (body._tag === "None") return HttpServerResponse.empty({ status: 400 });
      return yield* account.signIn(body.value.token, body.value.key ?? null).pipe(
        Effect.map((signedIn) =>
          HttpServerResponse.jsonUnsafe(encodeSignIn(signedIn), { headers: NO_STORE }),
        ),
        Effect.catch((error) => {
          const answer = accountRefusalAnswer(error);
          return Effect.succeed(
            HttpServerResponse.jsonUnsafe(answer.body, {
              status: answer.status,
              headers: NO_STORE,
            }),
          );
        }),
      );
    }).pipe(Effect.withSpan("majordome.account.signIn"));

    return HttpRouter.add("POST", MAJORDOME_ACCOUNT_SIGN_IN_PATH, signIn);
  }),
);
