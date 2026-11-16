/** An `HttpClient` answered by a function, so tests of API clients never leave the machine. */

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { HttpClient, HttpClientResponse } from "effect/http";

export interface SentRequest {
  readonly method: string;
  readonly url: URL;
  /** `METHOD host/path`, the usual way to pick an answer. */
  readonly route: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** "Uint8Array" for a body held in memory, "Stream" for a file being uploaded. */
  readonly bodyTag: string;
  /** The body as JSON, or null when it is not JSON. */
  readonly json: unknown;
  readonly at: number;
}

export interface FakeReply {
  readonly status?: number;
  readonly body?: unknown;
  /** A binary answer, in place of `body`. */
  readonly bytes?: Uint8Array;
  readonly headers?: Record<string, string>;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const encodeBody = (body: unknown) => JSON.stringify(body);

export function fakeHttp(handle: (sent: SentRequest) => FakeReply | Effect.Effect<FakeReply>) {
  const requests: Array<SentRequest> = [];
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      for (const [key, value] of request.urlParams.params) {
        url.searchParams.append(key, Redacted.isRedacted(value) ? Redacted.value(value) : value);
      }
      const body =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      const sent: SentRequest = {
        method: request.method,
        url,
        route: `${request.method} ${url.host}${url.pathname}`,
        headers: request.headers,
        body,
        bodyTag: request.body._tag,
        json: parseJson(body),
        at: yield* Clock.currentTimeMillis,
      };
      requests.push(sent);
      const answer = handle(sent);
      const reply = Effect.isEffect(answer) ? yield* answer : answer;
      const status = reply.status ?? 200;
      const content =
        reply.bytes !== undefined
          ? new Uint8Array(reply.bytes)
          : reply.body === undefined || status === 204
            ? null
            : encodeBody(reply.body);
      return HttpClientResponse.fromWeb(
        request,
        new Response(content, {
          status,
          headers: { "content-type": "application/json", ...reply.headers },
        }),
      );
    }),
  );
  return { client, requests };
}
