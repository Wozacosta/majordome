/**
 * Google Drive for backups: Google's sign-in for limited-input devices, and the few Drive calls a
 * backup needs. The `drive.file` scope lets Majordome see only the files it created, so it keeps
 * them in one "Majordome backups" folder it made itself.
 */

import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

// The Majordome Google OAuth app (TVs and limited-input devices) comes from these variables, set at
// build time or in a local .env. It stays out of the repository: Google disables OAuth secrets it
// finds in public code.
const GOOGLE_CLIENT_ID_VARIABLE = "MAJORDOME_GOOGLE_CLIENT_ID";
const GOOGLE_CLIENT_SECRET_VARIABLE = "MAJORDOME_GOOGLE_CLIENT_SECRET";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_NAME = "Majordome backups";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const OAUTH = "https://oauth2.googleapis.com";
const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const REQUEST_TIMEOUT = Duration.seconds(30);
const UPLOAD_TIMEOUT = Duration.hours(2);

export interface GoogleClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** The environment's OAuth app when it names one, else the one baked into the build. */
export function resolveGoogleClient(
  environment: Readonly<Record<string, string | undefined>>,
  built: GoogleClient,
): GoogleClient {
  const clientId = environment[GOOGLE_CLIENT_ID_VARIABLE]?.trim() ?? "";
  if (clientId === "") return built;
  return { clientId, clientSecret: environment[GOOGLE_CLIENT_SECRET_VARIABLE]?.trim() ?? "" };
}

export const GoogleDriveErrorReason = Schema.Literals([
  "signed-out",
  "access-removed",
  "quota-full",
  "expired",
  "denied",
  "failed",
]);

export class GoogleDriveError extends Schema.TaggedError<GoogleDriveError>()("GoogleDriveError", {
  reason: GoogleDriveErrorReason,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const failed = (message: string, cause?: unknown) =>
  new GoogleDriveError({ reason: "failed", message, ...(cause === undefined ? {} : { cause }) });

const SIGNED_OUT = new GoogleDriveError({
  reason: "signed-out",
  message: "Google Drive signed Majordome out. Connect Google Drive again.",
});

// Google answers OAuth refusals with 4xx statuses and the reason in `error`.
const OAuthResponse = Schema.Struct({
  device_code: Schema.optional(Schema.String),
  user_code: Schema.optional(Schema.String),
  verification_url: Schema.optional(Schema.String),
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  interval: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
});
const decodeOAuth = Schema.decodeUnknownOption(OAuthResponse);

const DriveErrorBody = Schema.Struct({
  error: Schema.optional(
    Schema.Struct({
      errors: Schema.optional(
        Schema.Array(Schema.Struct({ reason: Schema.optional(Schema.String) })),
      ),
    }),
  ),
});
const decodeDriveError = Schema.decodeUnknownOption(DriveErrorBody);

const DriveFile = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  trashed: Schema.optional(Schema.Boolean),
});
const decodeDriveFile = Schema.decodeUnknownOption(DriveFile);
const decodeDriveList = Schema.decodeUnknownOption(
  Schema.Struct({ files: Schema.Array(DriveFile) }),
);

const readJson = (response: HttpClientResponse.HttpClientResponse) =>
  response.json.pipe(Effect.orElseSucceed((): unknown => ({})));

const postOAuth = Effect.fn("majordome.google.postOAuth")(function* (
  path: string,
  body: Record<string, string>,
) {
  const http = yield* HttpClient.HttpClient;
  const response = yield* http
    .execute(
      HttpClientRequest.post(`${OAUTH}${path}`).pipe(
        HttpClientRequest.setHeaders({ accept: "application/json" }),
        HttpClientRequest.bodyUrlParams(body),
      ),
    )
    .pipe(Effect.timeout(REQUEST_TIMEOUT));
  return Option.getOrElse(
    decodeOAuth(yield* readJson(response)),
    () => ({}) as typeof OAuthResponse.Type,
  );
});

export interface GoogleDeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly expiresAt: number;
  readonly interval: number;
}

export const requestGoogleDeviceCode = Effect.fn("majordome.google.requestDeviceCode")(function* (
  client: GoogleClient,
) {
  const code = yield* postOAuth("/device/code", {
    client_id: client.clientId,
    scope: DRIVE_FILE_SCOPE,
  }).pipe(
    Effect.mapError((cause) =>
      failed(
        "Could not reach Google to start the sign-in. Check the internet connection and try again.",
        cause,
      ),
    ),
  );
  if (
    code.device_code === undefined ||
    code.user_code === undefined ||
    code.verification_url === undefined ||
    code.expires_in === undefined
  ) {
    return yield* failed(
      code.error_description ??
        `Google would not start the sign-in (${code.error ?? "no reason"}).`,
    );
  }
  return {
    deviceCode: code.device_code,
    userCode: code.user_code,
    verificationUrl: code.verification_url,
    expiresAt: (yield* Clock.currentTimeMillis) + code.expires_in * 1_000,
    interval: code.interval ?? 5,
  } satisfies GoogleDeviceCode;
});

export interface GoogleTokens {
  readonly refreshToken: string;
  readonly accessToken: string;
  readonly expiresAt: number;
}

/** Polls until the person approves the code, at Google's interval, slowing down when told. */
export const pollGoogleDeviceToken = Effect.fn("majordome.google.pollDeviceToken")(
  function* (input: { readonly client: GoogleClient; readonly code: GoogleDeviceCode }) {
    let interval = input.code.interval;
    while (true) {
      yield* Effect.sleep(Duration.seconds(interval));
      if ((yield* Clock.currentTimeMillis) >= input.code.expiresAt) {
        return yield* new GoogleDriveError({
          reason: "expired",
          message: "The sign-in code ran out of time. Choose Continue for a new one.",
        });
      }
      const answer = yield* postOAuth("/token", {
        client_id: input.client.clientId,
        client_secret: input.client.clientSecret,
        device_code: input.code.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }).pipe(Effect.option);
      // A dropped poll is retried on the next tick; the code stays valid until it expires.
      if (Option.isNone(answer)) continue;
      const response = answer.value;
      if (response.access_token !== undefined && response.refresh_token !== undefined) {
        return {
          refreshToken: response.refresh_token,
          accessToken: response.access_token,
          expiresAt: (yield* Clock.currentTimeMillis) + (response.expires_in ?? 3_600) * 1_000,
        } satisfies GoogleTokens;
      }
      switch (response.error) {
        case "authorization_pending":
          continue;
        case "slow_down":
          interval += 5;
          continue;
        case "expired_token":
          return yield* new GoogleDriveError({
            reason: "expired",
            message: "The sign-in code ran out of time. Choose Continue for a new one.",
          });
        case "access_denied":
          return yield* new GoogleDriveError({
            reason: "denied",
            message: "The sign-in was cancelled on Google.",
          });
        default:
          return yield* failed(
            response.error_description ??
              `Google refused the sign-in (${response.error ?? "no reason given"}).`,
          );
      }
    }
  },
);

export const refreshGoogleAccessToken = Effect.fn("majordome.google.refreshAccessToken")(
  function* (input: { readonly client: GoogleClient; readonly refreshToken: string }) {
    const response = yield* postOAuth("/token", {
      client_id: input.client.clientId,
      client_secret: input.client.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }).pipe(
      Effect.mapError((cause) =>
        failed("Could not reach Google Drive. Check the internet connection.", cause),
      ),
    );
    // Revoked, expired (Testing apps' sign-ins last 7 days) or the password changed.
    if (response.error === "invalid_grant") return yield* SIGNED_OUT;
    if (response.access_token === undefined) {
      return yield* failed(`Google did not renew the sign-in (${response.error ?? "no token"}).`);
    }
    return {
      accessToken: response.access_token,
      expiresAt: (yield* Clock.currentTimeMillis) + (response.expires_in ?? 3_600) * 1_000,
    };
  },
);

/** Best effort: a token Google already dropped is just as signed out. */
export const revokeGoogleToken = Effect.fn("majordome.google.revokeToken")(function* (
  token: string,
) {
  const http = yield* HttpClient.HttpClient;
  yield* http
    .execute(
      HttpClientRequest.post(`${OAUTH}/revoke`).pipe(HttpClientRequest.bodyUrlParams({ token })),
    )
    .pipe(Effect.timeout(REQUEST_TIMEOUT), Effect.ignore);
});

/** Plain words for a Drive API refusal. */
export function driveError(status: number, body: unknown): GoogleDriveError {
  const reasons: ReadonlyArray<string> = Option.match(decodeDriveError(body), {
    onNone: () => [],
    onSome: (decoded) => (decoded.error?.errors ?? []).flatMap((error) => error.reason ?? []),
  });
  if (status === 401) return SIGNED_OUT;
  if (reasons.includes("storageQuotaExceeded")) {
    return new GoogleDriveError({
      reason: "quota-full",
      message: "Your Google Drive is full. Free up space there and the next backup goes through.",
    });
  }
  if (
    status === 403 &&
    reasons.some((reason) =>
      ["insufficientPermissions", "insufficientFilePermissions", "appNotAuthorizedToFile"].includes(
        reason,
      ),
    )
  ) {
    return new GoogleDriveError({
      reason: "access-removed",
      message: "Majordome no longer has access to Google Drive. Connect Google Drive again.",
    });
  }
  return failed(
    `Google Drive could not take the backup (error ${status}${reasons[0] ? `, ${reasons[0]}` : ""}). Majordome tries again in a few minutes.`,
  );
}

/** Sends a Drive request; a 2xx answer gives its JSON body, anything else a mapped error. */
const driveCall = Effect.fn("majordome.google.driveCall")(function* (
  request: HttpClientRequest.HttpClientRequest,
  accessToken: string,
  timeout: Duration.Input = REQUEST_TIMEOUT,
) {
  const http = yield* HttpClient.HttpClient;
  const response = yield* http
    .execute(request.pipe(HttpClientRequest.bearerToken(accessToken)))
    .pipe(
      Effect.timeout(timeout),
      Effect.mapError((cause) =>
        failed("Could not reach Google Drive. Check the internet connection.", cause),
      ),
    );
  const body = response.status === 204 ? {} : yield* readJson(response);
  if (response.status < 200 || response.status >= 300) {
    return yield* driveError(response.status, body);
  }
  return { body, headers: response.headers };
});

const quote = (value: string) => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

/**
 * The backups folder: the remembered one while it still exists, else one found by name (only
 * folders Majordome made are visible), else a new one.
 */
export const findOrCreateDriveFolder = Effect.fn("majordome.google.findOrCreateFolder")(
  function* (input: { readonly accessToken: string; readonly knownId: string | null }) {
    if (input.knownId !== null) {
      const known = yield* driveCall(
        HttpClientRequest.get(`${DRIVE}/files/${encodeURIComponent(input.knownId)}`).pipe(
          HttpClientRequest.setUrlParams({ fields: "id,trashed" }),
        ),
        input.accessToken,
      ).pipe(
        Effect.map(({ body }) => decodeDriveFile(body)),
        Effect.catchIf(
          (error) => error.reason === "failed",
          () => Effect.succeedNone,
        ),
      );
      if (Option.isSome(known) && known.value.trashed !== true) return known.value.id;
    }
    const found = yield* driveCall(
      HttpClientRequest.get(`${DRIVE}/files`).pipe(
        HttpClientRequest.setUrlParams({
          q: `name = ${quote(DRIVE_FOLDER_NAME)} and mimeType = ${quote(FOLDER_MIME_TYPE)} and trashed = false`,
          fields: "files(id,name)",
          spaces: "drive",
        }),
      ),
      input.accessToken,
    );
    const existing = Option.flatMap(decodeDriveList(found.body), (list) =>
      Option.fromNullishOr(list.files[0]),
    );
    if (Option.isSome(existing)) return existing.value.id;
    const created = yield* driveCall(
      HttpClientRequest.post(`${DRIVE}/files`).pipe(
        HttpClientRequest.setUrlParams({ fields: "id" }),
        HttpClientRequest.bodyJsonUnsafe({ name: DRIVE_FOLDER_NAME, mimeType: FOLDER_MIME_TYPE }),
      ),
      input.accessToken,
    );
    return yield* Option.match(decodeDriveFile(created.body), {
      onNone: () => Effect.fail(failed("Google Drive did not create the backups folder.")),
      onSome: (file) => Effect.succeed(file.id),
    });
  },
);

/** A resumable upload sent in one request, so a backup of any size goes up the same way. */
export const uploadDriveFile = Effect.fn("majordome.google.uploadFile")(function* (input: {
  readonly accessToken: string;
  readonly folderId: string;
  readonly name: string;
  readonly path: string;
  readonly size: number;
}) {
  const session = yield* driveCall(
    HttpClientRequest.post(`${DRIVE_UPLOAD}/files`).pipe(
      HttpClientRequest.setUrlParams({ uploadType: "resumable", fields: "id" }),
      HttpClientRequest.setHeaders({
        "x-upload-content-type": "application/octet-stream",
        "x-upload-content-length": String(input.size),
      }),
      HttpClientRequest.bodyJsonUnsafe({ name: input.name, parents: [input.folderId] }),
    ),
    input.accessToken,
  );
  const location = session.headers["location"];
  if (location === undefined) return yield* failed("Google Drive did not open an upload.");
  const request = yield* HttpClientRequest.put(location).pipe(
    HttpClientRequest.bodyFile(input.path, { contentType: "application/octet-stream" }),
    Effect.mapError((cause) => failed("Could not read the backup to upload it.", cause)),
  );
  const uploaded = yield* driveCall(request, input.accessToken, UPLOAD_TIMEOUT);
  return yield* Option.match(decodeDriveFile(uploaded.body), {
    onNone: () => Effect.fail(failed("Google Drive did not confirm the upload.")),
    onSome: (file) => Effect.succeed(file.id),
  });
});

/**
 * Keeps the newest `keep` backups of this vault in the folder: today's new copy replaces an older
 * one of the same day, and files that are not this vault's backups are never touched.
 */
export const pruneDriveBackups = Effect.fn("majordome.google.pruneBackups")(function* (input: {
  readonly accessToken: string;
  readonly folderId: string;
  readonly fileNamePattern: RegExp;
  readonly keepId: string;
  readonly keep: number;
}) {
  const listed = yield* driveCall(
    HttpClientRequest.get(`${DRIVE}/files`).pipe(
      HttpClientRequest.setUrlParams({
        q: `${quote(input.folderId)} in parents and trashed = false`,
        fields: "files(id,name)",
        pageSize: "1000",
      }),
    ),
    input.accessToken,
  );
  const files = Option.match(decodeDriveList(listed.body), {
    onNone: () => [],
    onSome: (list) => list.files.filter((file) => input.fileNamePattern.test(file.name ?? "")),
  });
  const kept = files.find((file) => file.id === input.keepId);
  const others = files
    .filter((file) => file.id !== input.keepId && file.name !== kept?.name)
    .toSorted((left, right) => (right.name ?? "").localeCompare(left.name ?? ""));
  const sameDay = files.filter((file) => file.id !== input.keepId && file.name === kept?.name);
  const deleted: Array<string> = [];
  for (const file of [...sameDay, ...others.slice(Math.max(0, input.keep - 1))]) {
    yield* driveCall(
      HttpClientRequest.delete(`${DRIVE}/files/${encodeURIComponent(file.id)}`),
      input.accessToken,
    );
    deleted.push(file.id);
  }
  return deleted;
});
