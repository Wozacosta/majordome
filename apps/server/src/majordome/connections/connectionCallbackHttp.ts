/**
 * Where an app sends the owner's browser after a sign-in. Anyone can open this address, so it
 * does one thing with what it is given, shows fixed words, and never repeats what the app sent.
 */

import { CONNECTION_CALLBACK_PATH } from "@t3tools/shared/majordomeConnections";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { requestUrl } from "../../requestUrl.ts";
import * as MajordomeConnections from "./MajordomeConnections.ts";

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const page = (title: string, line: string) =>
  HttpServerResponse.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title><style>body{margin:0;padding:48px 24px;font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f4efe6;color:#14161c}@media (prefers-color-scheme:dark){body{background:#14161c;color:#f4efe6}}main{max-width:30rem;margin:0 auto}h1{font-size:22px;margin:0 0 8px}p{margin:0}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(line)}</p></main></body></html>`,
    { headers: { "cache-control": "no-store" } },
  );

export const layer = HttpRouter.add(
  "GET",
  CONNECTION_CALLBACK_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = requestUrl(request);
    const state = Option.getOrUndefined(url)?.searchParams.get("state");
    if (Option.isNone(url) || !state) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }
    const connections = yield* MajordomeConnections.MajordomeConnections;
    return yield* connections
      .finishSignIn({
        state,
        code: url.value.searchParams.get("code"),
        issuer: url.value.searchParams.get("iss"),
      })
      .pipe(
        Effect.match({
          // The name is Majordome's own, from its list of apps.
          onSuccess: ({ name }) =>
            page(`${name} is connected`, "You can close this tab and go back to Majordome."),
          onFailure: () =>
            page(
              "That didn't work",
              "The sign-in could not be finished. Go back to Majordome and connect the app again.",
            ),
        }),
      );
  }),
);
