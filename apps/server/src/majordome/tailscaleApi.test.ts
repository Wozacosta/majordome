import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { HttpClient } from "effect/http";

import { fakeHttp, type FakeReply, type SentRequest } from "./fakeHttp.testkit.ts";
import {
  createAuthKey,
  deleteAuthKey,
  deleteDevice,
  exchangeOAuthToken,
  isTailscaleClientSecret,
  listDevices,
  type TailscaleApiError,
} from "./tailscaleApi.ts";

const SECRET = "tskey-client-kAbCdEf1CNTRL-SecretPart0123456789";
const ACCESS = "tskey-api-access-0123456789";

const withTailscale = (handle: (sent: SentRequest) => FakeReply) => {
  const fake = fakeHttp(handle);
  return {
    requests: fake.requests,
    provide: Effect.provideService(HttpClient.HttpClient, fake.client),
  };
};

const failure = <A>(exit: Exit.Exit<A, TailscaleApiError>) =>
  Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined;

describe("Tailscale OAuth client", () => {
  it("recognizes a client secret", () => {
    expect(isTailscaleClientSecret(SECRET)).toBe(true);
    expect(isTailscaleClientSecret("tskey-auth-kAbC-Secret")).toBe(false);
    expect(isTailscaleClientSecret("tskey-api-kAbC-Secret")).toBe(false);
  });

  it.effect("trades the secret for an access token, naming the client the secret carries", () => {
    // The answer Tailscale's OAuth clients page documents.
    const tailscale = withTailscale(() => ({
      body: { access_token: ACCESS, token_type: "Bearer", expires_in: 3600, scope: "auth_keys" },
    }));
    return Effect.gen(function* () {
      expect(yield* exchangeOAuthToken(SECRET)).toBe(ACCESS);
      expect(tailscale.requests[0]?.route).toBe("POST api.tailscale.com/api/v2/oauth/token");
      expect(Object.fromEntries(new URLSearchParams(tailscale.requests[0]?.body))).toEqual({
        client_id: "kAbCdEf1CNTRL",
        client_secret: SECRET,
        grant_type: "client_credentials",
      });
    }).pipe(tailscale.provide);
  });

  it.effect.each([400, 401])(
    "calls a %i from the token endpoint a bad secret, without echoing it",
    (status) => {
      const tailscale = withTailscale(() => ({
        status,
        body: { message: `invalid client ${SECRET}` },
      }));
      return Effect.gen(function* () {
        const error = failure(yield* Effect.exit(exchangeOAuthToken(SECRET)));
        expect(error?.reason).toBe("bad-credential");
        expect(JSON.stringify(error)).not.toContain(SECRET);
        expect(error?.message).not.toContain(SECRET);
      }).pipe(tailscale.provide);
    },
  );
});

describe("Tailscale auth keys", () => {
  it.effect("asks for a one-time, pre-approved, tagged key that is not ephemeral", () => {
    const tailscale = withTailscale(() => ({
      body: {
        id: "k123456CNTRL",
        key: "tskey-auth-k123456CNTRL-abcdef",
        created: "2026-11-16T10:00:00Z",
        expires: "2026-11-17T10:00:00Z",
        capabilities: { devices: { create: { tags: ["tag:majordome"] } } },
      },
    }));
    return Effect.gen(function* () {
      const key = yield* createAuthKey(ACCESS, {
        description: "Majordome server",
        expirySeconds: 86_400,
      });
      expect(key).toEqual({ id: "k123456CNTRL", key: "tskey-auth-k123456CNTRL-abcdef" });
      expect(tailscale.requests[0]?.route).toBe("POST api.tailscale.com/api/v2/tailnet/-/keys");
      expect(tailscale.requests[0]?.headers.authorization).toBe(`Bearer ${ACCESS}`);
      expect(tailscale.requests[0]?.json).toEqual({
        capabilities: {
          devices: {
            create: {
              reusable: false,
              ephemeral: false,
              preauthorized: true,
              tags: ["tag:majordome"],
            },
          },
        },
        expirySeconds: 86_400,
        description: "Majordome server",
      });
    }).pipe(tailscale.provide);
  });

  it.effect.each<{
    readonly status: number;
    readonly message: string;
    readonly reason: TailscaleApiError["reason"];
  }>([
    {
      status: 403,
      message: "calling actor does not have enough permissions",
      reason: "missing-scope",
    },
    {
      status: 400,
      message: "requested tags [tag:majordome] are invalid or not permitted",
      reason: "bad-tag",
    },
    { status: 400, message: "invalid expiry", reason: "failed" },
    { status: 500, message: "internal", reason: "failed" },
  ])("maps $status $message to $reason", ({ status, message, reason }) => {
    const tailscale = withTailscale(() => ({ status, body: { message } }));
    return Effect.gen(function* () {
      const error = failure(
        yield* Effect.exit(createAuthKey(ACCESS, { description: "x", expirySeconds: 60 })),
      );
      expect(error?.reason).toBe(reason);
      expect(error?.detail).toBe(message);
    }).pipe(tailscale.provide);
  });

  it.effect("deletes a key, and treats one already gone as deleted", () => {
    let status = 200;
    const tailscale = withTailscale(() => ({
      status,
      body: status === 200 ? {} : { message: "no" },
    }));
    return Effect.gen(function* () {
      yield* deleteAuthKey(ACCESS, "k123456CNTRL");
      status = 404;
      yield* deleteAuthKey(ACCESS, "k123456CNTRL");
      expect(tailscale.requests[0]?.route).toBe(
        "DELETE api.tailscale.com/api/v2/tailnet/-/keys/k123456CNTRL",
      );
    }).pipe(tailscale.provide);
  });
});

describe("Tailscale devices", () => {
  it.effect("lists every device with its tags and real name", () => {
    const tailscale = withTailscale(() => ({
      body: {
        devices: [
          {
            addresses: ["100.87.74.78"],
            id: "92960230385",
            nodeId: "n292kg92CNTRL",
            user: "owner@example.com",
            name: "majordome-1.tail1234.ts.net",
            hostname: "majordome",
            clientVersion: "1.104.7",
            os: "linux",
            created: "2026-11-16T10:05:00Z",
            keyExpiryDisabled: true,
            authorized: true,
            tags: ["tag:majordome"],
          },
          { nodeId: "nMac", name: "macbook.tail1234.ts.net", hostname: "macbook" },
        ],
      },
    }));
    return Effect.gen(function* () {
      const devices = yield* listDevices(ACCESS);
      expect(devices[0]).toEqual({
        nodeId: "n292kg92CNTRL",
        name: "majordome-1.tail1234.ts.net",
        hostname: "majordome",
        created: "2026-11-16T10:05:00Z",
        authorized: true,
        tags: ["tag:majordome"],
      });
      expect(devices[1]?.tags).toBeUndefined();
      expect(tailscale.requests[0]?.url.href).toBe(
        "https://api.tailscale.com/api/v2/tailnet/-/devices?fields=all",
      );
    }).pipe(tailscale.provide);
  });

  it.effect("removes a device by node id, and treats one already gone as removed", () => {
    let status = 200;
    const tailscale = withTailscale(() => ({ status }));
    return Effect.gen(function* () {
      yield* deleteDevice(ACCESS, "n292kg92CNTRL");
      status = 404;
      yield* deleteDevice(ACCESS, "n292kg92CNTRL");
      expect(tailscale.requests[0]?.route).toBe(
        "DELETE api.tailscale.com/api/v2/device/n292kg92CNTRL",
      );
    }).pipe(tailscale.provide);
  });
});
