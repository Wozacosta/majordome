import { describe, expect, it } from "vite-plus/test";

import {
  makeApnsClient,
  makeFcmClient,
  makePush,
  type PushMessage,
  type PushProvider,
  PushProviderError,
  readServiceAccount,
} from "./push.ts";
import { PROOF_AUDIENCE } from "./proof.ts";
import { makeIdentity, START, type TestIdentity } from "./testing.ts";

const BUNDLE_ID = "io.github.wozacosta.majordome.ios";
const IPHONE_TOKEN = "ab".repeat(32);
const ANDROID_TOKEN = "fcm-token_0123456789:APA91b";

const iphone = {
  platform: "ios",
  token: IPHONE_TOKEN,
  title: "Waiting for you",
  body: "Plan the week has a question.",
  tag: "majordome:thread-1",
  deepLink: "/threads/env-1/thread-1",
  topic: BUNDLE_ID,
  environment: "production",
} as const satisfies PushMessage;

const android = {
  platform: "android",
  token: ANDROID_TOKEN,
  title: "Couldn't finish",
  body: "Start my day",
  tag: "majordome:thread-2",
  deepLink: "/threads/env-1/thread-2",
} as const satisfies PushMessage;

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signed(identity: TestIdentity, message: object, now = START) {
  const text = JSON.stringify(message);
  const iat = Math.floor(now / 1000);
  return {
    publicKey: identity.publicKey,
    proof: await identity.sign({
      aud: PROOF_AUDIENCE,
      act: "push",
      sha: await sha256Hex(text),
      iat,
      exp: iat + 120,
    }),
    message: text,
    clientIp: "203.0.113.1",
  };
}

function setup(
  options: {
    readonly apns?: PushProvider | null;
    readonly fcm?: PushProvider | null;
    readonly perIdentity?: number;
    readonly perIp?: number;
  } = {},
) {
  const clock = { now: START };
  const counts = new Map<string, number>();
  const sent: Array<PushMessage> = [];
  const recording: PushProvider = {
    send: async (message) => {
      sent.push(message);
      return "sent";
    },
  };
  const push = makePush({
    usage: {
      count: async (key, hour) => {
        const next = (counts.get(`${key}@${hour}`) ?? 0) + 1;
        counts.set(`${key}@${hour}`, next);
        return next;
      },
    },
    apns: options.apns === undefined ? recording : options.apns,
    fcm: options.fcm === undefined ? recording : options.fcm,
    bundleId: BUNDLE_ID,
    now: () => clock.now,
    config: {
      maxPerIdentityPerHour: options.perIdentity ?? 5,
      maxPerIpPerHour: options.perIp ?? 50,
    },
  });
  return { push, sent, clock, counts };
}

describe("push", () => {
  it("passes a signed notification on to the phone's service and keeps only a count", async () => {
    const { push, sent, counts } = setup();
    const identity = await makeIdentity();

    expect(await push.send(await signed(identity, iphone))).toEqual({ result: "sent" });
    expect(await push.send(await signed(identity, android))).toEqual({ result: "sent" });

    expect(sent).toEqual([iphone, android]);
    expect([...counts.values()]).toEqual([2, 2]);
    for (const key of counts.keys()) {
      expect(key).not.toContain(IPHONE_TOKEN);
      expect(key).not.toContain("Waiting");
    }
  });

  it("refuses a notification not signed for exactly that text by that key", async () => {
    const { push, sent } = setup();
    const identity = await makeIdentity();
    const request = await signed(identity, iphone);
    const cases = [
      { ...request, message: JSON.stringify({ ...iphone, body: "Something else" }) },
      { ...request, publicKey: (await makeIdentity()).publicKey },
      {
        ...request,
        proof: await identity.proof("claim", START, { sha: await sha256Hex(request.message) }),
      },
      await signed(identity, iphone, START - 10 * 60 * 1000),
    ];
    for (const altered of cases) {
      await expect(push.send(altered)).rejects.toMatchObject({ code: "invalid_proof" });
    }
    expect(sent).toHaveLength(0);
  });

  it("limits what one computer, and one network, sends in an hour", async () => {
    const { push, sent, clock } = setup({ perIdentity: 2, perIp: 2 });
    const identity = await makeIdentity();
    await push.send(await signed(identity, iphone));
    await push.send(await signed(identity, iphone));
    await expect(push.send(await signed(identity, iphone))).rejects.toMatchObject({
      code: "rate_limited",
    });

    // Another key from the same network shares the network's count.
    await expect(push.send(await signed(await makeIdentity(), iphone))).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(sent).toHaveLength(2);

    clock.now += 60 * 60 * 1000;
    await push.send(await signed(identity, iphone, clock.now));
    expect(sent).toHaveLength(3);
  });

  it("says a kind of phone is not set up, without counting it", async () => {
    const { push, counts } = setup({ apns: null });
    expect(push.available).toEqual({ ios: false, android: true });
    await expect(push.send(await signed(await makeIdentity(), iphone))).rejects.toMatchObject({
      code: "push_off",
    });
    expect(counts.size).toBe(0);
  });

  it.each([
    ["another app's topic", { ...iphone, topic: "com.example.other" }],
    ["a token that is not one", { ...iphone, token: "../../3/device/x" }],
    ["no title", { ...iphone, title: " " }],
    ["a text too long", { ...iphone, body: "x".repeat(401) }],
    ["a link outside the app", { ...android, deepLink: "https://example.com" }],
    ["an unknown kind of phone", { ...android, platform: "windows" }],
  ])("refuses %s", async (_name, message) => {
    const { push, sent } = setup();
    await expect(push.send(await signed(await makeIdentity(), message))).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(sent).toHaveLength(0);
  });

  it("reports a token the service says is gone, and a refusal as upstream", async () => {
    const gone: PushProvider = { send: async () => "gone" };
    const refusing: PushProvider = {
      send: async () => {
        throw new PushProviderError(403, "InvalidProviderToken");
      },
    };
    const { push } = setup({ apns: gone, fcm: refusing });
    const identity = await makeIdentity();
    expect(await push.send(await signed(identity, iphone))).toEqual({ result: "gone" });
    await expect(push.send(await signed(identity, android))).rejects.toMatchObject({
      code: "upstream",
    });
  });
});

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function stubFetch(answer: (url: string) => Response) {
  const calls: Array<Call> = [];
  return {
    calls,
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: String(init?.body ?? ""),
      });
      return answer(url);
    },
  };
}

async function privateKeyPem(algorithm: EcKeyGenParams | RsaHashedKeyGenParams) {
  const pair = (await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])) as {
    readonly privateKey: CryptoKey;
  };
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(pkcs8)))}\n-----END PRIVATE KEY-----\n`;
}

const jwtPart = (jwt: string, index: number) =>
  JSON.parse(atob((jwt.split(".")[index] ?? "").replaceAll("-", "+").replaceAll("_", "/")));

describe("Apple's push service", () => {
  const client = async (answer: (url: string) => Response) => {
    const stub = stubFetch(answer);
    const clock = { now: START };
    const apns = makeApnsClient({
      privateKey: await privateKeyPem({ name: "ECDSA", namedCurve: "P-256" }),
      keyId: "KEY1234567",
      teamId: "TEAM123456",
      now: () => clock.now,
      fetch: stub.fetch,
    });
    return { apns, clock, calls: stub.calls };
  };

  it("sends an alert to the service the phone reported, signed with the team's key", async () => {
    const { apns, calls, clock } = await client(() => new Response(null, { status: 200 }));

    expect(await apns.send(iphone)).toBe("sent");
    expect(await apns.send({ ...iphone, environment: "sandbox" })).toBe("sent");

    const [first, second] = calls;
    expect(first?.url).toBe(`https://api.push.apple.com/3/device/${IPHONE_TOKEN}`);
    expect(second?.url).toBe(`https://api.sandbox.push.apple.com/3/device/${IPHONE_TOKEN}`);
    expect(first?.headers).toMatchObject({
      "apns-topic": BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": "majordome:thread-1",
      "apns-expiration": String(Math.floor(START / 1000) + 86_400),
    });
    expect(JSON.parse(first?.body ?? "")).toEqual({
      aps: {
        alert: { title: iphone.title, body: iphone.body },
        sound: "default",
        "thread-id": "majordome:thread-1",
      },
      body: { deepLink: iphone.deepLink },
    });
    const jwt = (first?.headers.authorization ?? "").replace(/^bearer /u, "");
    expect(jwtPart(jwt, 0)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(jwtPart(jwt, 1)).toEqual({ iss: "TEAM123456", iat: Math.floor(START / 1000) });
    // Apple refuses a token made again within 20 minutes, so one is kept for a while.
    expect(second?.headers.authorization).toBe(first?.headers.authorization);
    clock.now += 41 * 60 * 1000;
    await apns.send(iphone);
    expect(calls[2]?.headers.authorization).not.toBe(first?.headers.authorization);
  });

  it.each([
    [410, "Unregistered"],
    [400, "BadDeviceToken"],
    [400, "DeviceTokenNotForTopic"],
  ])("reads %i %s as a phone that is gone", async (status, reason) => {
    const { apns } = await client(() => Response.json({ reason }, { status }));
    expect(await apns.send(iphone)).toBe("gone");
  });

  it("raises any other refusal with Apple's reason", async () => {
    const { apns } = await client(() =>
      Response.json({ reason: "InvalidProviderToken" }, { status: 403 }),
    );
    await expect(apns.send(iphone)).rejects.toMatchObject({
      status: 403,
      reason: "InvalidProviderToken",
    });
  });
});

describe("Firebase Cloud Messaging", () => {
  const client = async (answer: (url: string) => Response) => {
    const stub = stubFetch((url) =>
      url === "https://oauth2.googleapis.com/token"
        ? Response.json({ access_token: `access-${stub.calls.length}`, expires_in: 3600 })
        : answer(url),
    );
    const clock = { now: START };
    const serviceAccount = readServiceAccount(
      JSON.stringify({
        project_id: "majordome-test",
        client_email: "push@majordome-test.iam.gserviceaccount.com",
        private_key: await privateKeyPem({
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        }),
      }),
    );
    if (serviceAccount === null) throw new Error("The test's service account was not read.");
    const fcm = makeFcmClient({ serviceAccount, now: () => clock.now, fetch: stub.fetch });
    return { fcm, clock, calls: stub.calls };
  };

  it("trades the service account for an access token once, then sends data the app shows", async () => {
    const { fcm, calls, clock } = await client(() => Response.json({ name: "sent" }));

    expect(await fcm.send(android)).toBe("sent");
    expect(await fcm.send(android)).toBe("sent");

    expect(calls.map((call) => new URL(call.url).host)).toEqual([
      "oauth2.googleapis.com",
      "fcm.googleapis.com",
      "fcm.googleapis.com",
    ]);
    const form = new URLSearchParams(calls[0]?.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = form.get("assertion") ?? "";
    expect(jwtPart(assertion, 0)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(jwtPart(assertion, 1)).toEqual({
      iss: "push@majordome-test.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: Math.floor(START / 1000),
      exp: Math.floor(START / 1000) + 3600,
    });
    expect(calls[1]?.url).toBe(
      "https://fcm.googleapis.com/v1/projects/majordome-test/messages:send",
    );
    expect(calls[1]?.headers.authorization).toBe("Bearer access-1");
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual({
      message: {
        token: ANDROID_TOKEN,
        android: { priority: "HIGH", ttl: "86400s" },
        data: {
          title: android.title,
          message: android.body,
          body: JSON.stringify({ deepLink: android.deepLink }),
          channelId: "majordome",
          tag: android.tag,
        },
      },
    });

    clock.now += 56 * 60 * 1000;
    await fcm.send(android);
    expect(calls.filter((call) => call.url.includes("oauth2")).length).toBe(2);
  });

  it("reads an unregistered token as a phone that is gone, and raises the rest", async () => {
    const gone = await client(() =>
      Response.json(
        { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } },
        { status: 404 },
      ),
    );
    expect(await gone.fcm.send(android)).toBe("gone");

    const refused = await client(() =>
      Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 }),
    );
    await expect(refused.fcm.send(android)).rejects.toMatchObject({
      status: 403,
      reason: "PERMISSION_DENIED",
    });
  });

  it("takes a text that is not a service account as no credentials", () => {
    expect(readServiceAccount(undefined)).toBeNull();
    expect(readServiceAccount("{}")).toBeNull();
  });
});
