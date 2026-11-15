import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as TestClock from "effect/testing/TestClock";

import {
  driveError,
  findOrCreateDriveFolder,
  pollGoogleDeviceToken,
  pruneDriveBackups,
  refreshGoogleAccessToken,
  requestGoogleDeviceCode,
  uploadDriveFile,
} from "./googleDriveApi.ts";
import { backupFilePattern } from "./vaultFolderBackup.ts";

interface Sent {
  readonly method: string;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly bodyTag: string;
  readonly at: number;
}

interface Reply {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** A fake Google: `handle` answers each request; nothing leaves the machine. */
function fakeGoogle(handle: (sent: Sent) => Reply) {
  const requests: Array<Sent> = [];
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const sent: Sent = {
          method: request.method,
          url: new URL(request.url),
          headers: request.headers,
          body:
            request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
          bodyTag: request.body._tag,
          at: yield* Clock.currentTimeMillis,
        };
        for (const [key, value] of request.urlParams.params) {
          sent.url.searchParams.append(
            key,
            Redacted.isRedacted(value) ? Redacted.value(value) : value,
          );
        }
        requests.push(sent);
        const reply = handle(sent);
        return HttpClientResponse.fromWeb(
          request,
          new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
            status: reply.status ?? 200,
            headers: { "content-type": "application/json", ...reply.headers },
          }),
        );
      }),
    ),
  );
  return { layer, requests };
}

const client = { clientId: "client-1.apps.googleusercontent.com", clientSecret: "GOCSPX-test" };
const code = {
  deviceCode: "device-1",
  userCode: "ABCD-EFGH",
  verificationUrl: "https://www.google.com/device",
  expiresAt: 1_800_000,
  interval: 5,
};
const form = (sent: Sent | undefined) => new URLSearchParams(sent?.body);

describe("Google device sign-in", () => {
  it.effect("asks for the drive.file scope only", () => {
    const { layer, requests } = fakeGoogle(() => ({
      body: {
        device_code: "device-1",
        user_code: "ABCD-EFGH",
        verification_url: "https://www.google.com/device",
        expires_in: 1800,
        interval: 5,
      },
    }));
    return Effect.gen(function* () {
      expect(yield* requestGoogleDeviceCode(client)).toEqual(code);
      expect(requests[0]?.url.href).toBe("https://oauth2.googleapis.com/device/code");
      expect(Object.fromEntries(form(requests[0]))).toEqual({
        client_id: client.clientId,
        scope: "https://www.googleapis.com/auth/drive.file",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("waits Google's interval, slows down when told, and returns the tokens", () => {
    // Google answers a pending poll with 428 and slow_down with 403.
    const answers: Array<Reply> = [
      { status: 428, body: { error: "authorization_pending" } },
      { status: 403, body: { error: "slow_down" } },
      { status: 428, body: { error: "authorization_pending" } },
      { body: { access_token: "ya29.access", refresh_token: "1//refresh", expires_in: 3599 } },
    ];
    const { layer, requests } = fakeGoogle(() => answers.shift() ?? {});
    return Effect.gen(function* () {
      const polling = yield* Effect.forkChild(pollGoogleDeviceToken({ client, code }));
      yield* TestClock.adjust("40 seconds");
      expect(yield* Fiber.join(polling)).toEqual({
        refreshToken: "1//refresh",
        accessToken: "ya29.access",
        expiresAt: 30_000 + 3_599_000,
      });
      expect(requests.map((sent) => sent.at)).toEqual([5_000, 10_000, 20_000, 30_000]);
      expect(Object.fromEntries(form(requests[0]))).toEqual({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        device_code: "device-1",
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("stops when the person declines, and when the code expires", () => {
    const declined = fakeGoogle(() => ({ status: 403, body: { error: "access_denied" } }));
    const pending = fakeGoogle(() => ({ status: 428, body: { error: "authorization_pending" } }));
    const expiredByGoogle = fakeGoogle(() => ({ status: 400, body: { error: "expired_token" } }));
    const reasonOf = (exit: Exit.Exit<unknown, { readonly reason: string }>) =>
      Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "succeeded";
    return Effect.gen(function* () {
      const denied = yield* Effect.forkChild(
        pollGoogleDeviceToken({ client, code }).pipe(Effect.provide(declined.layer)),
      );
      yield* TestClock.adjust("5 seconds");
      expect(reasonOf(yield* Fiber.await(denied))).toContain('"reason":"denied"');

      const timedOut = yield* Effect.forkChild(
        pollGoogleDeviceToken({ client, code: { ...code, expiresAt: 32_000 } }).pipe(
          Effect.provide(pending.layer),
        ),
      );
      yield* TestClock.adjust("30 seconds");
      expect(reasonOf(yield* Fiber.await(timedOut))).toContain('"reason":"expired"');

      const told = yield* Effect.forkChild(
        pollGoogleDeviceToken({ client, code: { ...code, expiresAt: 999_000 } }).pipe(
          Effect.provide(expiredByGoogle.layer),
        ),
      );
      yield* TestClock.adjust("5 seconds");
      expect(reasonOf(yield* Fiber.await(told))).toContain('"reason":"expired"');
    });
  });
});

describe("refreshGoogleAccessToken", () => {
  it.effect("renews the access token, and reads invalid_grant as signed out", () => {
    const renewed = fakeGoogle(() => ({ body: { access_token: "ya29.new", expires_in: 3599 } }));
    const revoked = fakeGoogle(() => ({ status: 400, body: { error: "invalid_grant" } }));
    return Effect.gen(function* () {
      const token = yield* refreshGoogleAccessToken({ client, refreshToken: "1//refresh" }).pipe(
        Effect.provide(renewed.layer),
      );
      expect(token).toEqual({ accessToken: "ya29.new", expiresAt: 3_599_000 });
      expect(Object.fromEntries(form(renewed.requests[0]))).toEqual({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: "refresh_token",
        refresh_token: "1//refresh",
      });
      const failure = yield* refreshGoogleAccessToken({ client, refreshToken: "1//old" }).pipe(
        Effect.provide(revoked.layer),
        Effect.flip,
      );
      expect(failure.reason).toBe("signed-out");
    });
  });
});

describe("Drive backups folder", () => {
  it.effect("keeps the remembered folder while it exists", () => {
    const { layer, requests } = fakeGoogle(() => ({ body: { id: "folder-1", trashed: false } }));
    return Effect.gen(function* () {
      expect(yield* findOrCreateDriveFolder({ accessToken: "ya29", knownId: "folder-1" })).toBe(
        "folder-1",
      );
      expect(requests.map((sent) => `${sent.method} ${sent.url.pathname}`)).toEqual([
        "GET /drive/v3/files/folder-1",
      ]);
      expect(requests[0]?.headers["authorization"]).toBe("Bearer ya29");
    }).pipe(Effect.provide(layer));
  });

  it.effect("finds the folder by name when the remembered one is gone, else creates it", () => {
    const found = fakeGoogle((sent) =>
      sent.url.pathname.endsWith("/folder-gone")
        ? { status: 404, body: { error: { errors: [{ reason: "notFound" }] } } }
        : { body: { files: [{ id: "folder-2", name: "Majordome backups" }] } },
    );
    const empty = fakeGoogle((sent) =>
      sent.method === "GET" ? { body: { files: [] } } : { body: { id: "folder-new" } },
    );
    return Effect.gen(function* () {
      expect(
        yield* findOrCreateDriveFolder({ accessToken: "ya29", knownId: "folder-gone" }).pipe(
          Effect.provide(found.layer),
        ),
      ).toBe("folder-2");
      expect(found.requests[1]?.url.searchParams.get("q")).toBe(
        "name = 'Majordome backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      );

      expect(
        yield* findOrCreateDriveFolder({ accessToken: "ya29", knownId: null }).pipe(
          Effect.provide(empty.layer),
        ),
      ).toBe("folder-new");
      const create = empty.requests[1];
      expect(`${create?.method} ${create?.url.pathname}`).toBe("POST /drive/v3/files");
      expect(JSON.parse(create?.body ?? "{}")).toEqual({
        name: "Majordome backups",
        mimeType: "application/vnd.google-apps.folder",
      });
    });
  });
});

it.layer(NodeServices.layer)("uploadDriveFile", (it) => {
  it.effect("opens a resumable upload into the folder, then sends the file to its session", () => {
    const session =
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=xyz";
    const { layer, requests } = fakeGoogle((sent) =>
      sent.method === "POST"
        ? { body: {}, headers: { location: session } }
        : { body: { id: "file-1", name: "majordome-brain-2026-11-15.age" } },
    );
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-drive-" });
      yield* fs.writeFileString(`${dir}/vault.age`, "age-encryption.org/v1 …");

      const id = yield* uploadDriveFile({
        accessToken: "ya29",
        folderId: "folder-1",
        name: "majordome-brain-2026-11-15.age",
        path: `${dir}/vault.age`,
        size: 24,
      }).pipe(Effect.provide(layer));

      expect(id).toBe("file-1");
      const [open, send] = requests;
      expect(`${open?.method} ${open?.url.origin}${open?.url.pathname}`).toBe(
        "POST https://www.googleapis.com/upload/drive/v3/files",
      );
      expect(open?.url.searchParams.get("uploadType")).toBe("resumable");
      expect(open?.headers["x-upload-content-type"]).toBe("application/octet-stream");
      expect(open?.headers["x-upload-content-length"]).toBe("24");
      expect(JSON.parse(open?.body ?? "{}")).toEqual({
        name: "majordome-brain-2026-11-15.age",
        parents: ["folder-1"],
      });
      expect(send?.method).toBe("PUT");
      expect(send?.url.searchParams.get("upload_id")).toBe("xyz");
      expect(send?.headers["authorization"]).toBe("Bearer ya29");
      expect(send?.bodyTag).not.toBe("Empty");
    });
  });
});

describe("pruneDriveBackups", () => {
  it.effect(
    "keeps the newest copies of this vault, replaces today's, and leaves other files",
    () => {
      const files = [
        { id: "new", name: "majordome-brain-2026-11-15.age" },
        { id: "same-day", name: "majordome-brain-2026-11-15.age" },
        { id: "d14", name: "majordome-brain-2026-11-14.age" },
        { id: "d13", name: "majordome-brain-2026-11-13.age" },
        { id: "d12", name: "majordome-brain-2026-11-12.age" },
        { id: "other-vault", name: "majordome-work-2026-01-01.age" },
        { id: "photo", name: "holiday.jpg" },
      ];
      const { layer, requests } = fakeGoogle((sent) =>
        sent.method === "GET" ? { body: { files } } : { status: 204 },
      );
      return Effect.gen(function* () {
        const deleted = yield* pruneDriveBackups({
          accessToken: "ya29",
          folderId: "folder-1",
          fileNamePattern: backupFilePattern("brain"),
          keepId: "new",
          keep: 3,
        });
        expect(deleted).toEqual(["same-day", "d12"]);
        expect(requests[0]?.url.searchParams.get("q")).toBe(
          "'folder-1' in parents and trashed = false",
        );
        expect(requests.slice(1).map((sent) => `${sent.method} ${sent.url.pathname}`)).toEqual([
          "DELETE /drive/v3/files/same-day",
          "DELETE /drive/v3/files/d12",
        ]);
      }).pipe(Effect.provide(layer));
    },
  );
});

it("says in plain words why Drive refused", () => {
  expect(driveError(401, {}).reason).toBe("signed-out");
  const quota = driveError(403, { error: { errors: [{ reason: "storageQuotaExceeded" }] } });
  expect(quota.reason).toBe("quota-full");
  expect(quota.message).toBe(
    "Your Google Drive is full. Free up space there and the next backup goes through.",
  );
  expect(
    driveError(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }).reason,
  ).toBe("access-removed");
  expect(driveError(500, {}).reason).toBe("failed");
});
