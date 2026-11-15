import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as TestClock from "effect/testing/TestClock";

import {
  createBackupRepo,
  githubCredentialEnv,
  pollDeviceToken,
  requestDeviceCode,
} from "./githubBackup.ts";

interface Sent {
  readonly url: string;
  readonly body: string;
  readonly authorization: string | undefined;
  readonly at: number;
}

/** A fake GitHub: `handle` answers each request; nothing leaves the machine. */
function fakeGitHub(handle: (sent: Sent) => { readonly status?: number; readonly body: unknown }) {
  const requests: Array<Sent> = [];
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const sent: Sent = {
          url: request.url,
          body:
            request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
          authorization: request.headers["authorization"],
          at: yield* Clock.currentTimeMillis,
        };
        requests.push(sent);
        const reply = handle(sent);
        return HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(reply.body), {
            status: reply.status ?? 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    ),
  );
  return { layer, requests };
}

const code = {
  deviceCode: "device-1",
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
  expiresAt: 900_000,
  interval: 5,
};

describe("GitHub device sign-in", () => {
  it.effect("asks for the repo scope with the app's client id", () => {
    const { layer, requests } = fakeGitHub(() => ({
      body: {
        device_code: "device-1",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
    }));
    return Effect.gen(function* () {
      expect(yield* requestDeviceCode("Ov23-test")).toEqual(code);
      const form = new URLSearchParams(requests[0]?.body);
      expect(requests[0]?.url).toBe("https://github.com/login/device/code");
      expect(form.get("client_id")).toBe("Ov23-test");
      expect(form.get("scope")).toBe("repo");
    }).pipe(Effect.provide(layer));
  });

  it.effect("waits GitHub's interval, slows down when told, and returns the token", () => {
    const answers = [
      { error: "authorization_pending" },
      { error: "slow_down", interval: 10 },
      { error: "authorization_pending" },
      { access_token: "gho_token", token_type: "bearer", scope: "repo" },
    ];
    const { layer, requests } = fakeGitHub(() => ({ body: answers.shift() }));
    return Effect.gen(function* () {
      const polling = yield* Effect.forkChild(pollDeviceToken({ clientId: "Ov23-test", code }));
      yield* TestClock.adjust("40 seconds");
      expect(yield* Fiber.join(polling)).toBe("gho_token");
      // Polls at 5s and 10s, then every 10s once GitHub asks to slow down.
      expect(requests.map((sent) => sent.at)).toEqual([5_000, 10_000, 20_000, 30_000]);
      const form = new URLSearchParams(requests[0]?.body);
      expect(form.get("device_code")).toBe("device-1");
      expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
    }).pipe(Effect.provide(layer));
  });

  it.effect("stops when the person declines, and when the code expires", () => {
    const declined = fakeGitHub(() => ({ body: { error: "access_denied" } }));
    const pending = fakeGitHub(() => ({ body: { error: "authorization_pending" } }));
    return Effect.gen(function* () {
      const first = yield* Effect.forkChild(pollDeviceToken({ clientId: "c", code }));
      yield* TestClock.adjust("5 seconds");
      const denied = yield* Fiber.await(first);
      expect(Exit.isFailure(denied) && JSON.stringify(denied.cause)).toContain("denied");

      const second = yield* Effect.forkChild(
        pollDeviceToken({ clientId: "c", code: { ...code, expiresAt: 12_000 } }).pipe(
          Effect.provide(pending.layer),
        ),
      );
      yield* TestClock.adjust("20 seconds");
      const expired = yield* Fiber.await(second);
      expect(Exit.isFailure(expired) && JSON.stringify(expired.cause)).toContain("expired");
    }).pipe(Effect.provide(declined.layer));
  });
});

describe("createBackupRepo", () => {
  it.effect("creates a private repository and adds a number when the name is taken", () => {
    const { layer, requests } = fakeGitHub((sent) => {
      const name = (JSON.parse(sent.body) as { name: string }).name;
      return name === "majordome-brain" || name === "majordome-brain-2"
        ? { status: 422, body: { message: "Repository creation failed." } }
        : {
            status: 201,
            body: {
              clone_url: `https://github.com/someone/${name}.git`,
              html_url: `https://github.com/someone/${name}`,
              full_name: `someone/${name}`,
            },
          };
    });
    return Effect.gen(function* () {
      expect(yield* createBackupRepo("gho_token")).toEqual({
        cloneUrl: "https://github.com/someone/majordome-brain-3.git",
        webUrl: "https://github.com/someone/majordome-brain-3",
        fullName: "someone/majordome-brain-3",
      });
      expect(requests.map((sent) => JSON.parse(sent.body).name)).toEqual([
        "majordome-brain",
        "majordome-brain-2",
        "majordome-brain-3",
      ]);
      expect(JSON.parse(requests[0]?.body ?? "{}").private).toBe(true);
      expect(requests[0]?.authorization).toBe("Bearer gho_token");
    }).pipe(Effect.provide(layer));
  });
});

it("signs git in through config in the environment, with credential helpers off", () => {
  const env = githubCredentialEnv("gho_token");
  expect(env["GIT_CONFIG_KEY_0"]).toBe("credential.helper");
  expect(env["GIT_CONFIG_VALUE_0"]).toBe("");
  expect(env["GIT_CONFIG_VALUE_1"]).toBe(
    `Authorization: Basic ${Buffer.from("x-access-token:gho_token").toString("base64")}`,
  );
});
