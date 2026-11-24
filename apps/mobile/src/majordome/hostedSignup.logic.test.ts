import { expect, it } from "vite-plus/test";

import {
  alreadyConnected,
  brokerUrl,
  makeHostedServer,
  NO_ANSWER_ERROR,
  READY_ATTEMPTS,
  READY_WAIT_MS,
  readSignupProgress,
  setupPageUrl,
  SIGNUP_IDLE,
  signupErrorMessage,
  signupNext,
  signupPairingUrl,
  signupProgress,
  storedPairingUrl,
  waitUntilReady,
  type SignupEvent,
  type SignupState,
} from "./hostedSignup.logic";

const server = {
  name: "majordome-abc",
  url: "https://majordome-abc.fly.dev",
  pairingUrl: "https://majordome-abc.fly.dev/pair#token=mjsetup-1-x",
};
const filed = { name: server.name, url: server.url };
const { pairingUrl } = server;

const answer = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const refusal = { kind: "error", message: "Not paid." } as const;

it("walks a signup from the purchase to the finished server", () => {
  const events: ReadonlyArray<readonly [SignupEvent, SignupState]> = [
    [
      { type: "pay", doing: "checking" },
      { step: "paying", doing: "checking" },
    ],
    [
      { type: "pay", doing: "buying" },
      { step: "paying", doing: "buying" },
    ],
    [{ type: "submit" }, { step: "making" }],
    [
      { type: "made", server },
      { step: "waiting", server },
    ],
    [{ type: "ready" }, { step: "pairing", server }],
    [
      { type: "paired", environmentId: "env-1", fresh: true },
      { step: "finishing", server, environmentId: "env-1" },
    ],
    [{ type: "finished" }, { step: "done" }],
  ];
  let state = SIGNUP_IDLE;
  for (const [event, expected] of events) {
    state = signupNext(state, event);
    expect(state).toEqual(expected);
  }
});

it("moves only on the event its step is waiting for", () => {
  const made: SignupState = { step: "made", server, error: "No answer." };
  const cases: ReadonlyArray<readonly [string, SignupState, SignupEvent, SignupState | "same"]> = [
    ["a second press while making", { step: "making" }, { type: "submit" }, "same"],
    ["a press once the server exists", made, { type: "submit" }, "same"],
    ["a purchase once the server exists", made, { type: "pay", doing: "checking" }, "same"],
    [
      "a refusal keeps the offer and says why",
      { step: "making" },
      { type: "stopped", note: refusal },
      { step: "idle", note: refusal },
    ],
    [
      "a closed purchase sheet says nothing",
      { step: "paying", doing: "buying" },
      { type: "stopped", note: null },
      SIGNUP_IDLE,
    ],
    [
      "a new try clears the last refusal",
      { step: "idle", note: refusal },
      { type: "pay", doing: "restoring" },
      { step: "paying", doing: "restoring" },
    ],
    [
      "a server made earlier has no setup left to finish",
      { step: "pairing", server: { ...filed, pairingUrl: null } },
      { type: "paired", environmentId: "env-1", fresh: false },
      { step: "done" },
    ],
    [
      "a failed connection keeps the server and never asks for the code again",
      { step: "pairing", server },
      { type: "pairingFailed", message: "No answer." },
      made,
    ],
    ["trying again connects only", made, { type: "retryPairing" }, { step: "pairing", server }],
    ["trying again with no server", SIGNUP_IDLE, { type: "retryPairing" }, "same"],
    [
      "a late refusal after the server was made",
      { step: "waiting", server },
      { type: "stopped", note: refusal },
      "same",
    ],
    [
      "a server kept on the phone, not connected",
      SIGNUP_IDLE,
      { type: "resumed", progress: { server: filed, environmentId: null }, pairingUrl },
      { step: "made", server, error: null },
    ],
    [
      "a server kept on a phone that lost its link, as after restoring a backup",
      SIGNUP_IDLE,
      { type: "resumed", progress: { server: filed, environmentId: null }, pairingUrl: null },
      { step: "made", server: { ...filed, pairingUrl: null }, error: null },
    ],
    [
      "a server kept on the phone, connected",
      SIGNUP_IDLE,
      { type: "resumed", progress: { server: filed, environmentId: "env-1" }, pairingUrl: null },
      { step: "finishing", server: { ...filed, pairingUrl: null }, environmentId: "env-1" },
    ],
    ["nothing kept", SIGNUP_IDLE, { type: "resumed", progress: null, pairingUrl: null }, "same"],
    [
      "the phone's copy read while a signup is under way",
      { step: "making" },
      { type: "resumed", progress: { server: filed, environmentId: null }, pairingUrl },
      "same",
    ],
  ];
  for (const [name, state, event, expected] of cases) {
    const next = signupNext(state, event);
    if (expected === "same") expect(next, name).toBe(state);
    else expect(next, name).toEqual(expected);
  }
});

it("keeps a made server in the file and its link apart, until each is no longer needed", () => {
  const cases: ReadonlyArray<
    readonly [SignupState, ReturnType<typeof signupProgress>, string | null]
  > = [
    [SIGNUP_IDLE, null, null],
    [{ step: "paying", doing: "confirming" }, null, null],
    [{ step: "making" }, null, null],
    [{ step: "waiting", server }, { server: filed, environmentId: null }, pairingUrl],
    [{ step: "pairing", server }, { server: filed, environmentId: null }, pairingUrl],
    [
      { step: "made", server, error: "No answer." },
      { server: filed, environmentId: null },
      pairingUrl,
    ],
    // Connected: the link is spent, so it is dropped while the rest waits for the last step.
    [
      { step: "finishing", server, environmentId: "env-1" },
      { server: filed, environmentId: "env-1" },
      null,
    ],
    [{ step: "done" }, null, null],
  ];
  for (const [state, kept, link] of cases) {
    expect(signupProgress(state), state.step).toEqual(kept);
    expect(JSON.stringify(signupProgress(state)), state.step).not.toContain("mjsetup");
    expect(signupPairingUrl(state), state.step).toBe(link);
    // What is written reads back the same.
    expect(readSignupProgress(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
  }
  expect(readSignupProgress({ server: { name: "x" }, environmentId: "env-1" })).toBeNull();
  expect(readSignupProgress("null")).toBeNull();
});

it("takes the link out of a file an earlier version wrote", () => {
  const old = { server, environmentId: null };
  expect(readSignupProgress(old)).toEqual({ server: filed, environmentId: null });
  expect(storedPairingUrl(old)).toBe(pairingUrl);
  expect(storedPairingUrl({ server: filed, environmentId: null })).toBeNull();
  expect(storedPairingUrl(null)).toBeNull();
});

it("asks for the account's server and decodes the service's answers", async () => {
  const cases: ReadonlyArray<
    readonly [string, number, unknown, Awaited<ReturnType<typeof makeHostedServer>>]
  > = [
    ["made", 200, server, { ok: true, server }],
    [
      "a server made earlier, which comes without a link",
      200,
      filed,
      { ok: true, server: { ...filed, pairingUrl: null } },
    ],
    [
      "not paid",
      402,
      { error: "not_paid", message: "This account has no server yet." },
      { ok: false, message: signupErrorMessage({ error: "not_paid" }) },
    ],
    [
      "full",
      503,
      { error: "full", message: "x" },
      { ok: false, message: signupErrorMessage({ error: "full" }) },
    ],
    [
      "host down",
      502,
      { error: "upstream", message: "x" },
      { ok: false, message: signupErrorMessage({ error: "upstream" }) },
    ],
    ["not JSON", 500, undefined, { ok: false, message: signupErrorMessage(null) }],
    [
      "an answer missing the address",
      200,
      { name: "n" },
      { ok: false, message: signupErrorMessage(null) },
    ],
  ];
  for (const [name, status, body, expected] of cases) {
    const calls: Array<unknown> = [];
    const result = await makeHostedServer(
      async (url, init) => {
        calls.push([url, init]);
        if (body === undefined) {
          return { ...answer(status, null), json: () => Promise.reject(new Error("html")) };
        }
        return answer(status, body);
      },
      "https://broker.test",
      "token-1",
    );
    expect(result, name).toEqual(expected);
    expect(calls).toEqual([
      [
        "https://broker.test/v1/hosted",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"accountToken":"token-1"}',
        },
      ],
    ]);
  }
  expect(
    await makeHostedServer(() => Promise.reject(new TypeError("Network request failed")), "b", "c"),
  ).toEqual({ ok: false, message: NO_ANSWER_ERROR });
});

it("says something different for each refusal the person can act on", () => {
  const messages = ["invalid_account", "not_paid", "rate_limited", "upstream", "something_new"].map(
    (error) => signupErrorMessage({ error }),
  );
  expect(new Set(messages).size).toBe(messages.length);
  expect(signupErrorMessage({ error: "invalid_request" })).toBe(signupErrorMessage("<html>"));
});

it("asks whether the server answers until it does, pausing between tries", async () => {
  const answers: Array<unknown> = [{ ready: false }, "down", { ready: "yes" }, { ready: true }];
  const asked: Array<string> = [];
  const waits: Array<number> = [];
  const ready = await waitUntilReady(
    async (url) => {
      asked.push(url);
      const next = answers.shift();
      if (next === "down") throw new TypeError("Network request failed");
      return answer(200, next);
    },
    "https://broker.test",
    "majordome abc",
    async (ms) => {
      waits.push(ms);
    },
  );
  expect(ready).toBe(true);
  expect(asked).toHaveLength(4);
  expect(asked[0]).toBe("https://broker.test/v1/hosted/ready?name=majordome%20abc");
  expect(waits).toEqual([READY_WAIT_MS, READY_WAIT_MS, READY_WAIT_MS]);
});

it("stops asking after the last try", async () => {
  let asked = 0;
  const ready = await waitUntilReady(
    async () => {
      asked += 1;
      return answer(200, { ready: false });
    },
    "b",
    "n",
    async () => undefined,
  );
  expect(ready).toBe(false);
  expect(asked).toBe(READY_ATTEMPTS);
});

it("reads the service's address from the build, or uses Majordome's", () => {
  expect(brokerUrl(undefined)).toBe("https://broker.majord.link");
  expect(brokerUrl("  ")).toBe("https://broker.majord.link");
  expect(brokerUrl("http://localhost:8787/")).toBe("http://localhost:8787");
});

it("builds the server's sign-in page address", () => {
  expect(setupPageUrl("https://majordome-abc.fly.dev", "AB CD")).toBe(
    "https://majordome-abc.fly.dev/pair#token=AB+CD",
  );
  expect(setupPageUrl("http://192.168.1.5:3773/", "T1")).toBe(
    "http://192.168.1.5:3773/pair#token=T1",
  );
  expect(setupPageUrl("not an address", "T1")).toBeNull();
});

it("knows a server this phone is already connected to by its address", () => {
  const saved = ["https://den.majord.link", "https://majordome-abc.fly.dev/"];
  expect(alreadyConnected("https://majordome-abc.fly.dev", saved)).toBe(true);
  expect(alreadyConnected("https://majordome-xyz.fly.dev", saved)).toBe(false);
  expect(alreadyConnected("not an address", ["not an address"])).toBe(false);
});
