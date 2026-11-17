/**
 * "Connect GitHub": GitHub's device sign-in for the Majordome OAuth app, then a private
 * `majordome-brain` repository to push the vault to. OAuth apps can only ask for the `repo` scope,
 * which covers every repository of the account; the backup screen says so.
 */

import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

/** The Majordome OAuth app's public client id (device flow, no secret). */
export const DEFAULT_GITHUB_CLIENT_ID = "Ov23liVaVe9vjebAmBZP";
export const GITHUB_CLIENT_ID_VARIABLE = "MAJORDOME_GITHUB_CLIENT_ID";
const BACKUP_REPO_NAME = "majordome-brain";

const REQUEST_TIMEOUT = Duration.seconds(20);
const MAX_NAME_ATTEMPTS = 20;

export class GitHubBackupError extends Schema.TaggedError<GitHubBackupError>()(
  "GitHubBackupError",
  {
    reason: Schema.Literals(["expired", "denied", "failed"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.optional(Schema.String),
  user_code: Schema.optional(Schema.String),
  verification_uri: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  interval: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
});

// GitHub answers token polls with HTTP 200 and puts refusals in `error`.
const TokenResponse = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  interval: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
});
type TokenResponse = typeof TokenResponse.Type;

const CreatedRepo = Schema.Struct({
  clone_url: Schema.String,
  html_url: Schema.String,
  full_name: Schema.String,
});

const failed = (message: string, cause?: unknown) =>
  new GitHubBackupError({ reason: "failed", message, ...(cause === undefined ? {} : { cause }) });

const postForm = Effect.fn("majordome.github.postForm")(function* <S extends Schema.Top>(
  path: string,
  body: Record<string, string>,
  schema: S,
) {
  const http = yield* HttpClient.HttpClient;
  return yield* http
    .execute(
      HttpClientRequest.post(`https://github.com${path}`).pipe(
        HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "majordome" }),
        HttpClientRequest.bodyUrlParams(body),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.timeout(REQUEST_TIMEOUT),
    );
});

export interface DeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAt: number;
  readonly interval: number;
}

export const requestDeviceCode = Effect.fn("majordome.github.requestDeviceCode")(function* (
  clientId: string,
) {
  const code = yield* postForm(
    "/login/device/code",
    { client_id: clientId, scope: "repo" },
    DeviceCodeResponse,
  ).pipe(Effect.mapError((cause) => failed("Could not reach GitHub to start the sign-in.", cause)));
  if (
    code.device_code === undefined ||
    code.user_code === undefined ||
    code.verification_uri === undefined ||
    code.expires_in === undefined
  ) {
    return yield* failed(
      code.error_description ??
        `GitHub would not start the sign-in (${code.error ?? "no reason"}).`,
    );
  }
  return {
    deviceCode: code.device_code,
    userCode: code.user_code,
    verificationUri: code.verification_uri,
    expiresAt: (yield* Clock.currentTimeMillis) + code.expires_in * 1_000,
    interval: code.interval ?? 5,
  } satisfies DeviceCode;
});

/**
 * Polls until the person approves the code on GitHub, following GitHub's interval and its
 * `slow_down` answers. A dropped request is retried at the next tick while the code is valid.
 */
export const pollDeviceToken = Effect.fn("majordome.github.pollDeviceToken")(function* (input: {
  readonly clientId: string;
  readonly code: DeviceCode;
}) {
  let interval = input.code.interval;
  while (true) {
    yield* Effect.sleep(Duration.seconds(interval));
    if ((yield* Clock.currentTimeMillis) >= input.code.expiresAt) {
      return yield* new GitHubBackupError({
        reason: "expired",
        message: "The sign-in code expired. Start again.",
      });
    }
    const answer: Option.Option<TokenResponse> = yield* postForm(
      "/login/oauth/access_token",
      {
        client_id: input.clientId,
        device_code: input.code.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
      TokenResponse,
    ).pipe(Effect.option);
    if (Option.isNone(answer)) continue;
    const response = answer.value;
    if (response.access_token !== undefined) return response.access_token;
    switch (response.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval = response.interval ?? interval + 5;
        continue;
      case "expired_token":
        return yield* new GitHubBackupError({
          reason: "expired",
          message: "The sign-in code expired. Start again.",
        });
      case "access_denied":
        return yield* new GitHubBackupError({
          reason: "denied",
          message: "The sign-in was cancelled on GitHub.",
        });
      default:
        return yield* failed(
          response.error_description ??
            `GitHub refused the sign-in (${response.error ?? "no reason given"}).`,
        );
    }
  }
});

/** What git says when GitHub turns a push or fetch away for who is asking. */
export function isGitHubSignInFailure(message: string): boolean {
  return /could not read Username|Authentication failed|Invalid username or (password|token)|HTTP 401|returned error: 40[13]/i.test(
    message,
  );
}

/** True only when GitHub itself says the sign-in is no longer good; unreachable is not rejected. */
export const githubTokenRejected = Effect.fn("majordome.github.tokenRejected")(function* (
  token: string,
) {
  const http = yield* HttpClient.HttpClient;
  return yield* http
    .execute(
      HttpClientRequest.get("https://api.github.com/user").pipe(
        HttpClientRequest.setHeaders({
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": "majordome",
          "x-github-api-version": "2022-11-28",
        }),
      ),
    )
    .pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.map((response) => response.status === 401),
      Effect.catchCause(() => Effect.succeed(false)),
    );
});

/** Creates a private repository, adding `-2`, `-3`… when the name is taken. */
export const createBackupRepo = Effect.fn("majordome.github.createBackupRepo")(function* (
  token: string,
) {
  const http = yield* HttpClient.HttpClient;
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const name = attempt === 1 ? BACKUP_REPO_NAME : `${BACKUP_REPO_NAME}-${attempt}`;
    const response = yield* http
      .execute(
        HttpClientRequest.post("https://api.github.com/user/repos").pipe(
          HttpClientRequest.setHeaders({
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "user-agent": "majordome",
            "x-github-api-version": "2022-11-28",
          }),
          HttpClientRequest.bodyJsonUnsafe({
            name,
            private: true,
            description: "My notes, backed up by Majordome",
            has_issues: false,
            has_wiki: false,
            has_projects: false,
          }),
        ),
      )
      .pipe(
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError((cause) => failed("Could not reach GitHub.", cause)),
      );
    // 422 is GitHub's answer for a name already in use.
    if (response.status === 422) continue;
    if (response.status === 401) {
      return yield* failed("GitHub no longer accepts this sign-in. Connect GitHub again.");
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* failed(`GitHub could not create the repository (HTTP ${response.status}).`);
    }
    const repo = yield* HttpClientResponse.schemaBodyJson(CreatedRepo)(response).pipe(
      Effect.mapError((cause) =>
        failed("GitHub answered in a way Majordome did not expect.", cause),
      ),
    );
    return { cloneUrl: repo.clone_url, webUrl: repo.html_url, fullName: repo.full_name };
  }
  return yield* failed(
    `Every name from ${BACKUP_REPO_NAME} to ${BACKUP_REPO_NAME}-${MAX_NAME_ATTEMPTS} is taken.`,
  );
});

/**
 * Git configuration, passed through the environment, that signs pushes to github.com in with the
 * token: never in the remote URL, the vault's config, or a command line. Credential helpers are
 * switched off so a stale Keychain login is never tried instead.
 */
export function githubCredentialEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_1: `Authorization: Basic ${basic}`,
  };
}
