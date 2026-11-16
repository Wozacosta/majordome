/**
 * The few Hetzner Cloud calls "Set up a server for me" needs: what a server costs and where it can
 * be ordered, a firewall, the server itself, and the actions Hetzner answers slow work with.
 * Reference: https://docs.hetzner.cloud/reference/cloud
 */

import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

const API = "https://api.hetzner.cloud/v1";
const REQUEST_TIMEOUT = Duration.seconds(30);
const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT = Duration.seconds(10);
const ACTION_POLL_INTERVAL = Duration.seconds(3);
const ACTION_TIMEOUT = Duration.minutes(5);

export const HetznerErrorReason = Schema.Literals([
  "unauthorized",
  "read-only",
  "limit",
  "unavailable",
  "name-taken",
  "in-use",
  "rate-limited",
  "not-found",
  "invalid",
  "unreachable",
  "failed",
]);
export type HetznerErrorReason = typeof HetznerErrorReason.Type;

const REASON_MESSAGES: Record<HetznerErrorReason, string> = {
  unauthorized: "Hetzner does not accept this key. Make a new one and paste it again.",
  "read-only":
    "This Hetzner key can only read. Make a new one with Read & Write and paste it again.",
  limit:
    "Your Hetzner account has reached its limit for servers. Ask Hetzner to raise it, or remove a server you no longer use.",
  unavailable: "Hetzner has no server of this kind free in that location right now.",
  "name-taken": "That name is already in use in your Hetzner project.",
  "in-use": "Hetzner is still using that, so it could not be removed yet.",
  "rate-limited": "Hetzner asked Majordome to slow down. Try again in a few minutes.",
  "not-found": "Hetzner no longer has that.",
  invalid: "Hetzner did not accept the request.",
  unreachable: "Could not reach Hetzner. Check this computer's internet connection.",
  failed: "Hetzner could not do that.",
};

/** `code` and `status` are Hetzner's own. There is no `cause`: requests and answers hold secrets. */
export class HetznerError extends Schema.TaggedError<HetznerError>()("HetznerError", {
  reason: HetznerErrorReason,
  code: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Number),
}) {
  override get message(): string {
    const base = REASON_MESSAGES[this.reason];
    return (this.reason === "failed" || this.reason === "invalid") && this.code !== undefined
      ? `${base} (${this.code})`
      : base;
  }
}

const ErrorBody = Schema.Struct({
  error: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String) })),
});
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);

const Price = Schema.Struct({ net: Schema.String, gross: Schema.String });
const Deprecation = Schema.NullOr(
  Schema.Struct({ unavailable_after: Schema.optional(Schema.String) }),
);

const ServerType = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  cores: Schema.Number,
  memory: Schema.Number,
  disk: Schema.Number,
  cpu_type: Schema.String,
  architecture: Schema.String,
  prices: Schema.Array(
    Schema.Struct({ location: Schema.String, price_monthly: Price, price_hourly: Price }),
  ),
  /** Where the type can be ordered; older answers leave it out. */
  locations: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        available: Schema.optional(Schema.Boolean),
        deprecation: Schema.optional(Deprecation),
      }),
    ),
  ),
});
export type HetznerServerType = typeof ServerType.Type;

const Location = Schema.Struct({
  name: Schema.String,
  country: Schema.String,
  city: Schema.String,
  network_zone: Schema.String,
});
export type HetznerLocation = typeof Location.Type;

const Action = Schema.Struct({
  id: Schema.Number,
  status: Schema.Literals(["running", "success", "error"]),
  error: Schema.optional(Schema.NullOr(Schema.Struct({ code: Schema.optional(Schema.String) }))),
});
export type HetznerAction = typeof Action.Type;

const Labels = Schema.Record(Schema.String, Schema.String);

const Server = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  status: Schema.String,
  labels: Schema.optional(Labels),
  server_type: Schema.optional(Schema.Struct({ name: Schema.String })),
  public_net: Schema.optional(
    Schema.Struct({
      ipv4: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.optional(Schema.Number) }))),
    }),
  ),
});
export type HetznerServer = typeof Server.Type;

const Firewall = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  labels: Schema.optional(Labels),
});
export type HetznerFirewall = typeof Firewall.Type;

const Pricing = Schema.Struct({
  pricing: Schema.Struct({
    currency: Schema.String,
    primary_ips: Schema.optional(
      Schema.Array(
        Schema.Struct({
          type: Schema.String,
          prices: Schema.Array(Schema.Struct({ location: Schema.String, price_monthly: Price })),
        }),
      ),
    ),
  }),
});
export type HetznerPricing = (typeof Pricing.Type)["pricing"];

const Pagination = Schema.Struct({
  meta: Schema.optional(
    Schema.Struct({
      pagination: Schema.optional(
        Schema.Struct({ next_page: Schema.optional(Schema.NullOr(Schema.Number)) }),
      ),
    }),
  ),
});
const decodePagination = Schema.decodeUnknownOption(Pagination);

function reasonFor(status: number, code: string | undefined, write: boolean): HetznerErrorReason {
  switch (code) {
    case "unauthorized":
      return "unauthorized";
    case "resource_limit_exceeded":
      return "limit";
    case "resource_unavailable":
    case "placement_error":
      return "unavailable";
    case "uniqueness_error":
      return "name-taken";
    case "resource_in_use":
    case "locked":
    case "conflict":
      return "in-use";
    case "rate_limit_exceeded":
      return "rate-limited";
    case "not_found":
      return "not-found";
    case "invalid_input":
    case "json_error":
      return "invalid";
  }
  if (status === 401) return "unauthorized";
  // A read-only key is refused every write; Hetzner has no call that says what a key may do.
  if (status === 403) return write ? "read-only" : "unauthorized";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  return "failed";
}

interface RequestOptions {
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

const send = Effect.fn("majordome.hetzner.send")(function* (
  token: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  options?: RequestOptions,
) {
  const http = yield* HttpClient.HttpClient;
  let request = HttpClientRequest.make(method)(`${API}${path}`).pipe(
    HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "majordome" }),
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.setUrlParams(options?.query ?? {}),
  );
  if (options?.body !== undefined) {
    request = HttpClientRequest.bodyJsonUnsafe(request, options.body);
  }
  for (let attempt = 0; ; attempt++) {
    const response = yield* http.execute(request).pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      // The failed request carries the key in its headers, so it is not kept as the cause.
      Effect.mapError(() => new HetznerError({ reason: "unreachable" })),
    );
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      yield* Effect.sleep(RATE_LIMIT_WAIT);
      continue;
    }
    const json: unknown =
      response.status === 204 ? {} : yield* response.json.pipe(Effect.orElseSucceed(() => ({})));
    if (response.status >= 200 && response.status < 300) return json;
    const code = Option.getOrUndefined(decodeErrorBody(json))?.error?.code;
    return yield* new HetznerError({
      reason: reasonFor(response.status, code, method !== "GET"),
      status: response.status,
      ...(code === undefined ? {} : { code }),
    });
  }
});

const decode = <S extends Schema.Decoder<unknown>>(schema: S, json: unknown) =>
  Schema.decodeUnknownEffect(schema)(json).pipe(
    // An answer can hold a new server's root password, so the parse error is not kept either.
    Effect.mapError(() => new HetznerError({ reason: "failed", code: "unexpected_answer" })),
  );

/** Every page of a list, by `meta.pagination.next_page`. */
const listAll = Effect.fn("majordome.hetzner.listAll")(function* <A>(
  token: string,
  path: string,
  items: (json: unknown) => Effect.Effect<ReadonlyArray<A>, HetznerError>,
  query?: Readonly<Record<string, string>>,
) {
  const all: Array<A> = [];
  for (let number = 1; number <= MAX_PAGES; number++) {
    const json = yield* send(token, "GET", path, {
      query: { ...query, page: String(number), per_page: String(PAGE_SIZE) },
    });
    all.push(...(yield* items(json)));
    const next = Option.getOrUndefined(decodePagination(json))?.meta?.pagination?.next_page;
    if (next === undefined || next === null) break;
  }
  return all;
});

const notFoundAsNone = <A, R>(effect: Effect.Effect<A, HetznerError, R>) =>
  effect.pipe(
    Effect.asSome,
    Effect.catchIf(
      (error) => error.reason === "not-found",
      () => Effect.succeed(Option.none<A>()),
    ),
  );

export const listServerTypes = (token: string) =>
  listAll(token, "/server_types", (json) =>
    decode(Schema.Struct({ server_types: Schema.Array(ServerType) }), json).pipe(
      Effect.map((body) => body.server_types),
    ),
  );

export const listLocations = (token: string) =>
  listAll(token, "/locations", (json) =>
    decode(Schema.Struct({ locations: Schema.Array(Location) }), json).pipe(
      Effect.map((body) => body.locations),
    ),
  );

export const getPricing = Effect.fn("majordome.hetzner.getPricing")(function* (token: string) {
  return (yield* decode(Pricing, yield* send(token, "GET", "/pricing"))).pricing;
});

export const listServers = (token: string, labelSelector: string) =>
  listAll(
    token,
    "/servers",
    (json) =>
      decode(Schema.Struct({ servers: Schema.Array(Server) }), json).pipe(
        Effect.map((body) => body.servers),
      ),
    { label_selector: labelSelector },
  );

export const getServer = (token: string, id: number) =>
  send(token, "GET", `/servers/${id}`).pipe(
    Effect.flatMap((json) => decode(Schema.Struct({ server: Server }), json)),
    Effect.map((answer) => answer.server),
    notFoundAsNone,
  );

export interface CreateServerInput {
  readonly name: string;
  readonly serverType: string;
  readonly location: string;
  readonly image: string;
  readonly userData: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly firewallId: number;
}

const CreatedServer = Schema.Struct({
  server: Server,
  action: Action,
  next_actions: Schema.optional(Schema.Array(Action)),
});

/**
 * Orders a server with no SSH key and no inbound access. Hetzner mails a root password to the
 * account when no key is given; nothing uses it, and the firewall keeps SSH closed.
 */
export const createServer = Effect.fn("majordome.hetzner.createServer")(function* (
  token: string,
  input: CreateServerInput,
) {
  const json = yield* send(token, "POST", "/servers", {
    body: {
      name: input.name,
      server_type: input.serverType,
      location: input.location,
      image: input.image,
      user_data: input.userData,
      labels: input.labels,
      firewalls: [{ firewall: input.firewallId }],
      start_after_create: true,
      // GitHub's package registry, where the image lives, answers on IPv4 only.
      public_net: { enable_ipv4: true, enable_ipv6: true },
    },
  });
  const created = yield* decode(CreatedServer, json);
  return {
    server: created.server,
    actions: [created.action, ...(created.next_actions ?? [])],
  };
});

/** Deletes a server and returns Hetzner's action for it; none when it is already gone. */
export const deleteServer = (token: string, id: number) =>
  send(token, "DELETE", `/servers/${id}`).pipe(
    Effect.flatMap((json) => decode(Schema.Struct({ action: Action }), json)),
    Effect.map((answer) => answer.action),
    notFoundAsNone,
  );

export const listFirewalls = (token: string, labelSelector: string) =>
  listAll(
    token,
    "/firewalls",
    (json) =>
      decode(Schema.Struct({ firewalls: Schema.Array(Firewall) }), json).pipe(
        Effect.map((body) => body.firewalls),
      ),
    { label_selector: labelSelector },
  );

export const getFirewall = (token: string, id: number) =>
  send(token, "GET", `/firewalls/${id}`).pipe(
    Effect.flatMap((json) => decode(Schema.Struct({ firewall: Firewall }), json)),
    Effect.map((answer) => answer.firewall),
    notFoundAsNone,
  );

/** A firewall with no rules: Hetzner then drops everything inbound and allows everything outbound. */
export const createFirewall = Effect.fn("majordome.hetzner.createFirewall")(function* (
  token: string,
  input: { readonly name: string; readonly labels: Readonly<Record<string, string>> },
) {
  const json = yield* send(token, "POST", "/firewalls", {
    body: { name: input.name, labels: input.labels, rules: [] },
  });
  return (yield* decode(Schema.Struct({ firewall: Firewall }), json)).firewall;
});

/** Succeeds when it is gone, whether deleted now or earlier. */
export const deleteFirewall = (token: string, id: number) =>
  send(token, "DELETE", `/firewalls/${id}`).pipe(notFoundAsNone, Effect.asVoid);

/** The address Hetzner made with the server is billed until it is gone too. */
export const deletePrimaryIp = (token: string, id: number) =>
  send(token, "DELETE", `/primary_ips/${id}`).pipe(notFoundAsNone, Effect.asVoid);

const getAction = Effect.fn("majordome.hetzner.getAction")(function* (token: string, id: number) {
  return (yield* decode(
    Schema.Struct({ action: Action }),
    yield* send(token, "GET", `/actions/${id}`),
  )).action;
});

/** Polls an action until Hetzner finishes it; a failed or slow one is an error. */
export const waitForAction = Effect.fn("majordome.hetzner.waitForAction")(function* (
  token: string,
  action: HetznerAction,
  timeout: Duration.Duration = ACTION_TIMEOUT,
) {
  const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(timeout);
  let current = action;
  while (current.status === "running") {
    if ((yield* Clock.currentTimeMillis) >= deadline) {
      return yield* new HetznerError({ reason: "failed", code: "action_timeout" });
    }
    yield* Effect.sleep(ACTION_POLL_INTERVAL);
    current = yield* getAction(token, action.id);
  }
  if (current.status === "error") {
    const code = current.error?.code ?? undefined;
    return yield* new HetznerError({
      reason: reasonFor(0, code, true),
      ...(code === undefined ? {} : { code }),
    });
  }
});

/**
 * Whether the key may create things, by making an empty firewall and deleting it: firewalls are
 * free, and Hetzner has no call that says what a key is allowed to do.
 */
export const probeWriteAccess = Effect.fn("majordome.hetzner.probeWriteAccess")(function* (
  token: string,
  name: string,
) {
  const firewall = yield* createFirewall(token, { name, labels: { "majordome-check": "true" } });
  yield* deleteFirewall(token, firewall.id);
});
