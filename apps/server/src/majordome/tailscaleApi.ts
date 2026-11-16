/**
 * The Tailscale API calls "Set up a server for me" needs, signed in as an OAuth client: a one-time
 * key that lets the new server join the tailnet, the list of devices to find it by its real name,
 * and removing it again. Reference: https://tailscale.com/api
 */

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

const API = "https://api.tailscale.com/api/v2";
const REQUEST_TIMEOUT = Duration.seconds(30);
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT = Duration.seconds(10);

/** The tag every server Majordome sets up carries; an OAuth client can only add tagged devices. */
const MAJORDOME_TAG = "tag:majordome";

const CLIENT_SECRET_PATTERN = /^tskey-client-([A-Za-z0-9]+)-[A-Za-z0-9]+$/;

/** True for the secret Tailscale shows once when an OAuth client is made. */
export const isTailscaleClientSecret = (value: string) => CLIENT_SECRET_PATTERN.test(value);

export const TailscaleApiErrorReason = Schema.Literals([
  "bad-credential",
  "missing-scope",
  "bad-tag",
  "rate-limited",
  "not-found",
  "unreachable",
  "failed",
]);
export type TailscaleApiErrorReason = typeof TailscaleApiErrorReason.Type;

const REASON_MESSAGES: Record<TailscaleApiErrorReason, string> = {
  "bad-credential":
    "Tailscale does not accept this secret. Make a new OAuth credential and paste its secret again.",
  "missing-scope": "The Tailscale credential is not allowed to do this.",
  "bad-tag": `The Tailscale credential can't use the tag ${MAJORDOME_TAG}.`,
  "rate-limited": "Tailscale asked Majordome to slow down. Try again in a few minutes.",
  "not-found": "Tailscale no longer has that.",
  unreachable: "Could not reach Tailscale. Check this computer's internet connection.",
  failed: "Tailscale could not do that.",
};

/** `detail` is Tailscale's own short answer; the secret and tokens never appear in any field. */
export class TailscaleApiError extends Schema.TaggedError<TailscaleApiError>()(
  "TailscaleApiError",
  {
    reason: TailscaleApiErrorReason,
    status: Schema.optional(Schema.Number),
    detail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const base = REASON_MESSAGES[this.reason];
    return this.reason === "failed" && this.status !== undefined
      ? `${base} (HTTP ${this.status})`
      : base;
  }
}

const ErrorBody = Schema.Struct({ message: Schema.optional(Schema.String) });
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);

const TokenResponse = Schema.Struct({ access_token: Schema.String });

const CreatedKey = Schema.Struct({ id: Schema.String, key: Schema.String });

const Device = Schema.Struct({
  /** The id the API prefers in paths. */
  nodeId: Schema.String,
  /** The full MagicDNS name, such as `majordome-1.tail1234.ts.net`. */
  name: Schema.String,
  hostname: Schema.String,
  created: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  authorized: Schema.optional(Schema.Boolean),
});
export type TailscaleDevice = typeof Device.Type;

const DeviceList = Schema.Struct({ devices: Schema.Array(Device) });

const MAX_DETAIL_LENGTH = 200;

function reasonFor(status: number, detail: string | undefined): TailscaleApiErrorReason {
  if (status === 401) return "bad-credential";
  if (status === 403) return "missing-scope";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  // Tailscale answers a tag the credential does not own with 400 and a sentence naming tags.
  if (status === 400 && detail !== undefined && /\btags?\b/i.test(detail)) return "bad-tag";
  return "failed";
}

const send = Effect.fn("majordome.tailscale.send")(function* (
  request: HttpClientRequest.HttpClientRequest,
) {
  const http = yield* HttpClient.HttpClient;
  const prepared = request.pipe(
    HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "majordome" }),
  );
  for (let attempt = 0; ; attempt++) {
    const response = yield* http.execute(prepared).pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      // The failed request carries the secret or token, so it is not kept as the cause.
      Effect.mapError(() => new TailscaleApiError({ reason: "unreachable" })),
    );
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      yield* Effect.sleep(RATE_LIMIT_WAIT);
      continue;
    }
    const json: unknown = yield* response.json.pipe(Effect.orElseSucceed(() => ({})));
    if (response.status >= 200 && response.status < 300) return json;
    const detail = Option.getOrUndefined(decodeErrorBody(json))?.message?.slice(
      0,
      MAX_DETAIL_LENGTH,
    );
    return yield* new TailscaleApiError({
      reason: reasonFor(response.status, detail),
      status: response.status,
      ...(detail === undefined ? {} : { detail }),
    });
  }
});

const decode = <S extends Schema.Decoder<unknown>>(schema: S, json: unknown) =>
  Schema.decodeUnknownEffect(schema)(json).pipe(
    Effect.mapError(
      (cause) => new TailscaleApiError({ reason: "failed", detail: "unexpected answer", cause }),
    ),
  );

const notFoundIsDone = <R>(effect: Effect.Effect<unknown, TailscaleApiError, R>) =>
  effect.pipe(
    Effect.asVoid,
    Effect.catchIf(
      (error) => error.reason === "not-found",
      () => Effect.void,
    ),
  );

/**
 * Trades the OAuth client's secret for an access token, good for an hour. The secret names its
 * own client (`tskey-client-<id>-…`), so the owner pastes one value.
 */
export const exchangeOAuthToken = Effect.fn("majordome.tailscale.exchangeOAuthToken")(function* (
  clientSecret: string,
) {
  const clientId = CLIENT_SECRET_PATTERN.exec(clientSecret)?.[1] ?? "majordome";
  const json = yield* send(
    HttpClientRequest.post(`${API}/oauth/token`).pipe(
      HttpClientRequest.bodyUrlParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    ),
  ).pipe(
    // The token endpoint answers a wrong secret with 400 or 401.
    Effect.mapError((error) =>
      error.status === 400 || error.status === 401
        ? new TailscaleApiError({ reason: "bad-credential", status: error.status })
        : error,
    ),
  );
  return (yield* decode(TokenResponse, json)).access_token;
});

/**
 * A key one new device can join with, once: not reusable, not ephemeral (the server must stay
 * when it restarts), approved in advance, and tagged, as every key an OAuth client makes must be.
 */
export const createAuthKey = Effect.fn("majordome.tailscale.createAuthKey")(function* (
  accessToken: string,
  input: { readonly description: string; readonly expirySeconds: number },
) {
  const json = yield* send(
    HttpClientRequest.post(`${API}/tailnet/-/keys`).pipe(
      HttpClientRequest.bearerToken(accessToken),
      HttpClientRequest.bodyJsonUnsafe({
        capabilities: {
          devices: {
            create: {
              reusable: false,
              ephemeral: false,
              preauthorized: true,
              tags: [MAJORDOME_TAG],
            },
          },
        },
        expirySeconds: input.expirySeconds,
        description: input.description,
      }),
    ),
  );
  return yield* decode(CreatedKey, json);
});

export const deleteAuthKey = (accessToken: string, keyId: string) =>
  send(
    HttpClientRequest.delete(`${API}/tailnet/-/keys/${encodeURIComponent(keyId)}`).pipe(
      HttpClientRequest.bearerToken(accessToken),
    ),
  ).pipe(notFoundIsDone);

/** Every device of the tailnet, tags included; Tailscale answers in one page. */
export const listDevices = Effect.fn("majordome.tailscale.listDevices")(function* (
  accessToken: string,
) {
  const json = yield* send(
    HttpClientRequest.get(`${API}/tailnet/-/devices`).pipe(
      HttpClientRequest.bearerToken(accessToken),
      HttpClientRequest.setUrlParams({ fields: "all" }),
    ),
  );
  return (yield* decode(DeviceList, json)).devices;
});

export const deleteDevice = (accessToken: string, nodeId: string) =>
  send(
    HttpClientRequest.delete(`${API}/device/${encodeURIComponent(nodeId)}`).pipe(
      HttpClientRequest.bearerToken(accessToken),
    ),
  ).pipe(notFoundIsDone);
