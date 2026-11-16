import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import { HttpClient } from "effect/http";
import * as TestClock from "effect/testing/TestClock";

import { fakeHttp, type FakeReply, type SentRequest } from "./fakeHttp.testkit.ts";
import {
  createFirewall,
  createServer,
  deleteFirewall,
  deletePrimaryIp,
  deleteServer,
  getFirewall,
  getPricing,
  getServer,
  HetznerError,
  listFirewalls,
  listLocations,
  listServers,
  listServerTypes,
  probeWriteAccess,
  waitForAction,
} from "./hetznerApi.ts";

const TOKEN = "hetzner-test-token-0123456789";

const withHetzner = (handle: (sent: SentRequest) => FakeReply) => {
  const fake = fakeHttp(handle);
  return {
    requests: fake.requests,
    provide: Effect.provideService(HttpClient.HttpClient, fake.client),
  };
};

const failure = <A>(exit: Exit.Exit<A, HetznerError>) =>
  Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined;

// Shapes copied from the examples in Hetzner's API reference.
const serverType = {
  id: 114,
  name: "cx23",
  description: "CX23",
  cores: 2,
  memory: 4,
  disk: 40,
  prices: [
    {
      location: "fsn1",
      price_hourly: { net: "0.0056", gross: "0.0067" },
      price_monthly: { net: "3.4900", gross: "4.1531" },
      included_traffic: 21990232555520,
      price_per_tb_traffic: { net: "1.0000", gross: "1.1900" },
    },
  ],
  storage_type: "local",
  cpu_type: "shared",
  category: "Shared vCPU",
  architecture: "x86",
  deprecation: null,
  locations: [{ id: 1, name: "fsn1", deprecation: null, recommended: true, available: true }],
};
const server = {
  id: 42,
  name: "majordome",
  status: "initializing",
  created: "2026-11-16T10:00:00Z",
  public_net: {
    ipv4: { id: 7001, ip: "1.2.3.4", blocked: false, dns_ptr: "static.example" },
    ipv6: { ip: "2001:db8::/64", blocked: false, dns_ptr: [] },
    floating_ips: [],
    firewalls: [{ id: 38, status: "applied" }],
  },
  server_type: { id: 114, name: "cx23" },
  location: { id: 1, name: "fsn1", network_zone: "eu-central" },
  labels: { "managed-by": "majordome" },
};
const runningAction = {
  id: 1,
  command: "create_server",
  status: "running",
  progress: 0,
  started: "2026-11-16T10:00:00Z",
  finished: null,
  resources: [{ id: 42, type: "server" }],
  error: null,
};

describe("Hetzner lists", () => {
  it.effect("follows next_page to the last page and sends the key as a bearer token", () => {
    const hetzner = withHetzner((sent) =>
      sent.url.searchParams.get("page") === "1"
        ? {
            body: {
              server_types: [serverType],
              meta: { pagination: { page: 1, per_page: 50, next_page: 2, last_page: 2 } },
            },
          }
        : {
            body: {
              server_types: [{ ...serverType, id: 109, name: "cpx22" }],
              meta: { pagination: { page: 2, per_page: 50, next_page: null, last_page: 2 } },
            },
          },
    );
    return Effect.gen(function* () {
      const types = yield* listServerTypes(TOKEN);
      expect(types.map((type) => type.name)).toEqual(["cx23", "cpx22"]);
      expect(types[0]?.prices[0]?.price_monthly.gross).toBe("4.1531");
      expect(hetzner.requests.map((sent) => sent.url.searchParams.get("page"))).toEqual(["1", "2"]);
      expect(hetzner.requests[0]?.url.searchParams.get("per_page")).toBe("50");
      expect(hetzner.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    }).pipe(hetzner.provide);
  });

  it.effect("reads locations, pricing, and labelled servers and firewalls", () => {
    const hetzner = withHetzner((sent) => {
      switch (sent.route) {
        case "GET api.hetzner.cloud/v1/locations":
          return {
            body: {
              locations: [
                {
                  id: 1,
                  name: "fsn1",
                  description: "Falkenstein DC Park 1",
                  country: "DE",
                  city: "Falkenstein",
                  latitude: 50.47612,
                  longitude: 12.370071,
                  network_zone: "eu-central",
                },
              ],
              meta: { pagination: { next_page: null } },
            },
          };
        case "GET api.hetzner.cloud/v1/pricing":
          return {
            body: {
              pricing: {
                currency: "EUR",
                vat_rate: "19.00",
                primary_ips: [
                  {
                    type: "ipv4",
                    prices: [
                      {
                        location: "fsn1",
                        price_hourly: { net: "0.0008", gross: "0.0010" },
                        price_monthly: { net: "0.5000", gross: "0.5950" },
                      },
                    ],
                  },
                ],
              },
            },
          };
        case "GET api.hetzner.cloud/v1/servers":
          return { body: { servers: [server], meta: { pagination: { next_page: null } } } };
        default:
          return {
            body: {
              firewalls: [{ id: 38, name: "majordome", labels: {}, rules: [], applied_to: [] }],
              meta: { pagination: { next_page: null } },
            },
          };
      }
    });
    return Effect.gen(function* () {
      expect((yield* listLocations(TOKEN))[0]?.city).toBe("Falkenstein");
      expect((yield* getPricing(TOKEN)).currency).toBe("EUR");
      expect((yield* listServers(TOKEN, "majordome-move=abc"))[0]?.public_net?.ipv4?.id).toBe(7001);
      expect((yield* listFirewalls(TOKEN, "majordome-move=abc"))[0]?.id).toBe(38);
      expect(hetzner.requests[2]?.url.searchParams.get("label_selector")).toBe(
        "majordome-move=abc",
      );
    }).pipe(hetzner.provide);
  });
});

describe("Hetzner servers and firewalls", () => {
  it.effect(
    "orders a server with the firewall attached, labels and user data, and no SSH key",
    () => {
      const hetzner = withHetzner(() => ({
        status: 201,
        body: {
          server,
          action: runningAction,
          next_actions: [{ ...runningAction, id: 13, command: "start_server" }],
          root_password: "not-used",
        },
      }));
      return Effect.gen(function* () {
        const created = yield* createServer(TOKEN, {
          name: "majordome",
          serverType: "cx23",
          location: "fsn1",
          image: "ubuntu-24.04",
          userData: "#cloud-config\n",
          labels: { "managed-by": "majordome" },
          firewallId: 38,
        });
        expect(created.server.id).toBe(42);
        expect(created.actions.map((action) => action.id)).toEqual([1, 13]);
        expect(hetzner.requests[0]?.route).toBe("POST api.hetzner.cloud/v1/servers");
        expect(hetzner.requests[0]?.json).toEqual({
          name: "majordome",
          server_type: "cx23",
          location: "fsn1",
          image: "ubuntu-24.04",
          user_data: "#cloud-config\n",
          labels: { "managed-by": "majordome" },
          firewalls: [{ firewall: 38 }],
          start_after_create: true,
          public_net: { enable_ipv4: true, enable_ipv6: true },
        });
      }).pipe(hetzner.provide);
    },
  );

  it.effect("makes a firewall with no rules, which drops everything inbound", () => {
    const hetzner = withHetzner(() => ({
      status: 201,
      body: {
        firewall: { id: 38, name: "majordome", labels: { a: "b" }, rules: [], applied_to: [] },
        actions: [],
      },
    }));
    return Effect.gen(function* () {
      expect((yield* createFirewall(TOKEN, { name: "majordome", labels: { a: "b" } })).id).toBe(38);
      expect(hetzner.requests[0]?.json).toEqual({
        name: "majordome",
        labels: { a: "b" },
        rules: [],
      });
    }).pipe(hetzner.provide);
  });

  it.effect("treats what is already gone as removed", () => {
    const hetzner = withHetzner(() => ({
      status: 404,
      body: { error: { code: "not_found", message: "not found", details: null } },
    }));
    return Effect.gen(function* () {
      expect(Option.isNone(yield* getServer(TOKEN, 42))).toBe(true);
      expect(Option.isNone(yield* getFirewall(TOKEN, 38))).toBe(true);
      expect(Option.isNone(yield* deleteServer(TOKEN, 42))).toBe(true);
      yield* deleteFirewall(TOKEN, 38);
      yield* deletePrimaryIp(TOKEN, 7001);
      expect(hetzner.requests.map((sent) => sent.method)).toEqual([
        "GET",
        "GET",
        "DELETE",
        "DELETE",
        "DELETE",
      ]);
    }).pipe(hetzner.provide);
  });

  it.effect(
    "deletes a server and a firewall, which Hetzner answers with an action and a 204",
    () => {
      const hetzner = withHetzner((sent) =>
        sent.route === "DELETE api.hetzner.cloud/v1/servers/42"
          ? { body: { action: { ...runningAction, id: 9, command: "delete_server" } } }
          : { status: 204 },
      );
      return Effect.gen(function* () {
        expect(Option.getOrUndefined(yield* deleteServer(TOKEN, 42))?.id).toBe(9);
        yield* deleteFirewall(TOKEN, 38);
      }).pipe(hetzner.provide);
    },
  );
});

describe("Hetzner errors", () => {
  it.effect.each<{
    readonly status: number;
    readonly code: string;
    readonly reason: HetznerError["reason"];
  }>([
    { status: 401, code: "unauthorized", reason: "unauthorized" },
    { status: 403, code: "forbidden", reason: "read-only" },
    { status: 403, code: "resource_limit_exceeded", reason: "limit" },
    { status: 412, code: "resource_unavailable", reason: "unavailable" },
    { status: 422, code: "placement_error", reason: "unavailable" },
    { status: 409, code: "uniqueness_error", reason: "name-taken" },
    { status: 422, code: "resource_in_use", reason: "in-use" },
    { status: 422, code: "invalid_input", reason: "invalid" },
    { status: 500, code: "server_error", reason: "failed" },
  ])(
    "maps $status $code on a write to $reason without echoing the key",
    ({ status, code, reason }) => {
      const hetzner = withHetzner(() => ({
        status,
        body: { error: { code, message: `refused ${TOKEN}`, details: null } },
      }));
      return Effect.gen(function* () {
        const error = failure(
          yield* Effect.exit(createFirewall(TOKEN, { name: "majordome", labels: {} })),
        );
        expect(error?.reason).toBe(reason);
        expect(error?.code).toBe(code);
        expect(JSON.stringify(error)).not.toContain(TOKEN);
        expect(error?.message).not.toContain(TOKEN);
      }).pipe(hetzner.provide);
    },
  );

  it.effect("calls a refused read a bad key, since a read-only key may still read", () => {
    const hetzner = withHetzner(() => ({ status: 403, body: { error: { code: "forbidden" } } }));
    return Effect.gen(function* () {
      expect(failure(yield* Effect.exit(listLocations(TOKEN)))?.reason).toBe("unauthorized");
    }).pipe(hetzner.provide);
  });

  it.effect("waits and tries again when Hetzner says to slow down, then gives up", () => {
    let limited = 2;
    const hetzner = withHetzner(() =>
      limited-- > 0
        ? { status: 429, body: { error: { code: "rate_limit_exceeded" } } }
        : { body: { pricing: { currency: "EUR" } } },
    );
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(getPricing(TOKEN));
      yield* TestClock.adjust(Duration.seconds(20));
      expect((yield* Fiber.join(fiber)).currency).toBe("EUR");
      expect(hetzner.requests.map((sent) => sent.at)).toEqual([0, 10_000, 20_000]);

      limited = 99;
      const stuck = yield* Effect.forkChild(Effect.exit(getPricing(TOKEN)));
      yield* TestClock.adjust(Duration.minutes(1));
      expect(failure(yield* Fiber.join(stuck))?.reason).toBe("rate-limited");
    }).pipe(hetzner.provide);
  });

  it.effect("checks write access by making and deleting an empty firewall", () => {
    const hetzner = withHetzner((sent) =>
      sent.method === "POST"
        ? { status: 201, body: { firewall: { id: 5, name: "majordome-check" }, actions: [] } }
        : { status: 204 },
    );
    return Effect.gen(function* () {
      yield* probeWriteAccess(TOKEN, "majordome-check");
      expect(hetzner.requests.map((sent) => sent.route)).toEqual([
        "POST api.hetzner.cloud/v1/firewalls",
        "DELETE api.hetzner.cloud/v1/firewalls/5",
      ]);
    }).pipe(hetzner.provide);
  });
});

describe("Hetzner actions", () => {
  it.effect("polls until the action succeeds", () => {
    let polls = 0;
    const hetzner = withHetzner(() => ({
      body: { action: { ...runningAction, status: ++polls < 3 ? "running" : "success" } },
    }));
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        waitForAction(TOKEN, { id: 1, status: "running", error: null }),
      );
      yield* TestClock.adjust(Duration.seconds(9));
      yield* Fiber.join(fiber);
      expect(hetzner.requests.map((sent) => sent.route)).toEqual([
        "GET api.hetzner.cloud/v1/actions/1",
        "GET api.hetzner.cloud/v1/actions/1",
        "GET api.hetzner.cloud/v1/actions/1",
      ]);
    }).pipe(hetzner.provide);
  });

  it.effect("fails with Hetzner's reason when the action fails, and when it never finishes", () => {
    let answer: unknown = {
      ...runningAction,
      status: "error",
      error: { code: "resource_unavailable", message: "no capacity" },
    };
    const hetzner = withHetzner(() => ({ body: { action: answer } }));
    return Effect.gen(function* () {
      const failed = yield* Effect.forkChild(
        Effect.exit(waitForAction(TOKEN, { id: 1, status: "running", error: null })),
      );
      yield* TestClock.adjust(Duration.seconds(3));
      expect(failure(yield* Fiber.join(failed))?.reason).toBe("unavailable");

      answer = runningAction;
      const slow = yield* Effect.forkChild(
        Effect.exit(
          waitForAction(TOKEN, { id: 1, status: "running", error: null }, Duration.seconds(30)),
        ),
      );
      yield* TestClock.adjust(Duration.seconds(40));
      expect(failure(yield* Fiber.join(slow))?.code).toBe("action_timeout");
    }).pipe(hetzner.provide);
  });
});
