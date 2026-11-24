import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  ForwardCompatibleArray,
  ForwardCompatibleOptional,
  IsoDateTime,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const ProviderSetupInput = Schema.Struct({
  instanceId: ProviderInstanceId,
});
export type ProviderSetupInput = typeof ProviderSetupInput.Type;

const SetupOperationId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
// Environments supply these and clients open them, so a `javascript:` URL would run as the client.
export const SignInUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(16_384),
  Schema.isPattern(/^https?:\/\//i),
);

export const ProviderAuthMethod = Schema.Struct({
  id: SetupOperationId,
  accountEmail: Schema.optional(TrimmedNonEmptyString),
  canRemove: Schema.optionalKey(Schema.Boolean),
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  type: Schema.Literals(["agent", "terminal", "credentials"]),
});
export type ProviderAuthMethod = typeof ProviderAuthMethod.Type;

export const ProviderAuthInteraction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("browser"),
    id: SetupOperationId,
    url: SignInUrl,
    requiresConsent: Schema.Boolean,
    acceptsCallback: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("deviceCode"),
    id: SetupOperationId,
    url: SignInUrl,
    userCode: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  }),
  Schema.Struct({
    type: Schema.Literal("terminal"),
    id: SetupOperationId,
    output: Schema.String.check(Schema.isMaxLength(16_384)),
    outputOffset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  Schema.Struct({
    type: Schema.Literal("credentials"),
    id: SetupOperationId,
    fields: Schema.Array(
      Schema.Struct({
        name: SetupOperationId,
        label: TrimmedNonEmptyString,
        secret: Schema.Boolean,
      }),
    ).check(Schema.isMaxLength(16)),
  }),
]);
export type ProviderAuthInteraction = typeof ProviderAuthInteraction.Type;

export const ProviderAuthResponse = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("browser"),
    action: Schema.Literals(["accept", "decline"]),
  }),
  Schema.Struct({
    type: Schema.Literal("terminal"),
    data: Schema.String.check(Schema.isMaxLength(4_096)),
    // `data` holds one byte per UTF-16 code unit, as in `TerminalWriteInput`.
    binary: Schema.optionalKey(Schema.Boolean),
    size: Schema.optionalKey(
      Schema.Struct({
        cols: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
        rows: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
      }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("credentials"),
    values: Schema.Record(SetupOperationId, Schema.String.check(Schema.isMaxLength(16_384))).check(
      Schema.isMaxProperties(16),
    ),
  }),
]);
export type ProviderAuthResponse = typeof ProviderAuthResponse.Type;

export const ProviderAuthStartInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  methodId: Schema.optionalKey(SetupOperationId),
  returnUrl: Schema.optionalKey(Schema.String),
  callbackMode: Schema.optionalKey(Schema.Literals(["server", "client"])),
});
export type ProviderAuthStartInput = typeof ProviderAuthStartInput.Type;

export const ProviderAuthRemoveMethodInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  methodId: SetupOperationId,
});

export const ProviderAuthRespondInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  flowId: SetupOperationId,
  interactionId: SetupOperationId,
  response: ProviderAuthResponse,
});
export type ProviderAuthRespondInput = typeof ProviderAuthRespondInput.Type;

export const ProviderAuthState = Schema.Struct({
  instanceId: ProviderInstanceId,
  phase: Schema.Literals([
    "idle",
    "starting",
    "waiting",
    "verifying",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  flowId: Schema.NullOr(SetupOperationId),
  authorizationUrl: Schema.NullOr(SignInUrl),
  expiresAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(Schema.String),
  // Drop unknown auth methods rather than rejecting the entire state.
  methods: Schema.optionalKey(
    ForwardCompatibleArray(ProviderAuthMethod).check(Schema.isMaxLength(32)),
  ),
  interaction: ForwardCompatibleOptional(Schema.NullOr(ProviderAuthInteraction)),
  credentialOwner: ForwardCompatibleOptional(Schema.Literals(["provider", "t3"])),
});
export type ProviderAuthState = typeof ProviderAuthState.Type;

export const ProviderAuthCompleteInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  flowId: SetupOperationId,
  callbackUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(16_384)),
});
export type ProviderAuthCompleteInput = typeof ProviderAuthCompleteInput.Type;

export const ProviderAuthCancelInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  flowId: SetupOperationId,
});
export type ProviderAuthCancelInput = typeof ProviderAuthCancelInput.Type;

/** A full Claude sign-in running on the environment: its link opens in the owner's own browser. */
export const ClaudeSignInAttempt = Schema.Struct({
  attemptId: SetupOperationId,
  url: SignInUrl,
  expiresAt: IsoDateTime,
});
export type ClaudeSignInAttempt = typeof ClaudeSignInAttempt.Type;

export const ClaudeSignInSubmitInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  attemptId: SetupOperationId,
  // The code Claude's page shows after approval: a short-lived credential, so it stays redacted.
  code: Schema.RedactedFromValue(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
});
export type ClaudeSignInSubmitInput = typeof ClaudeSignInSubmitInput.Type;

export const ClaudeSignInCancelInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  attemptId: SetupOperationId,
});
export type ClaudeSignInCancelInput = typeof ClaudeSignInCancelInput.Type;

export const ClaudeSignInResult = Schema.Struct({
  // A sign-in token (`CLAUDE_CODE_OAUTH_TOKEN`) outranks the new sign-in while Claude sees it.
  /** The token saved in this provider's settings; `stillSet` is left for the owner to remove. */
  savedToken: Schema.Literals(["none", "removed", "stillSet"]),
  /** The token in the server's own environment: `ignored` once Claude runs without it here. */
  serverToken: Schema.Literals(["none", "ignored", "stillSet"]),
});
export type ClaudeSignInResult = typeof ClaudeSignInResult.Type;

const CLAUDE_SIGN_IN_ERROR_MESSAGES = {
  unavailable: "This provider can't sign in to Claude here.",
  notStarted:
    "Claude couldn't start its sign-in on this machine. Check that Claude Code is installed there, then try again.",
  noLink: "Claude didn't give a sign-in link in time. Try again.",
  noAttempt: "This sign-in is no longer open. Start over to get a new link.",
  expired: "This sign-in took too long and was closed. Start over to get a new link.",
  codeIncomplete:
    "That code looks incomplete. Copy the whole code from Claude's page and paste it again.",
  codeRejected:
    "Claude didn't accept that code. It may have expired or been used already. Start over to get a new one.",
  noAnswer: "Claude took too long to confirm the sign-in. Start over and try again.",
  failed: "Claude couldn't finish the sign-in. Start over and try again.",
} as const;

/** Safe sign-in failure text. Never carries the pasted code, the link, or the CLI's output. */
export class ClaudeSignInError extends Schema.TaggedError<ClaudeSignInError>()(
  "ClaudeSignInError",
  {
    instanceId: ProviderInstanceId,
    // Only `codeIncomplete` leaves the attempt open; after any other the owner starts over.
    reason: Schema.Literals([
      "unavailable",
      "notStarted",
      "noLink",
      "noAttempt",
      "expired",
      "codeIncomplete",
      "codeRejected",
      "noAnswer",
      "failed",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return CLAUDE_SIGN_IN_ERROR_MESSAGES[this.reason];
  }
}

const ByteCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ProviderInstallState = Schema.Struct({
  driver: ProviderDriverKind,
  operationId: Schema.NullOr(SetupOperationId),
  phase: Schema.Literals([
    "idle",
    "downloading",
    "extracting",
    "verifying",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  downloadedBytes: ByteCount,
  totalBytes: Schema.NullOr(ByteCount),
  version: Schema.NullOr(TrimmedNonEmptyString),
  installedVersion: Schema.NullOr(TrimmedNonEmptyString),
  executablePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  source: Schema.optionalKey(Schema.NullOr(Schema.Literals(["managed", "local"]))),
  canRemove: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
});
export type ProviderInstallState = typeof ProviderInstallState.Type;

export const ProviderInstallCancelInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  operationId: SetupOperationId,
});
export type ProviderInstallCancelInput = typeof ProviderInstallCancelInput.Type;

/** Safe setup failure text. Never include OAuth codes, URLs, or native token data. */
export class ProviderSetupError extends Schema.TaggedError<ProviderSetupError>()(
  "ProviderSetupError",
  {
    instanceId: ProviderInstanceId,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const ChatGptReconnectProfile = Schema.Struct({
  clientId: Schema.String.check(Schema.isPattern(/^oaiapp_[\w-]+$/u)),
  subject: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.NullOr(Schema.String)),
  redirectUri: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(/^http:\/\/(?:127\.0\.0\.1|localhost):[1-9]\d{0,4}\/auth\/callback$/u),
    ),
  ),
  connectionLabel: Schema.optionalKey(Schema.String),
  sharingEnabled: Schema.optionalKey(Schema.Boolean),
  idTokenHint: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(16_384))),
});
export type ChatGptReconnectProfile = typeof ChatGptReconnectProfile.Type;
export const ChatGptTransferredProfile = Schema.Struct({
  registration: ChatGptReconnectProfile,
  credentials: Schema.Struct({
    clientId: Schema.String,
    accessToken: Schema.NonEmptyString.check(Schema.isMaxLength(16_384)),
    refreshToken: Schema.NullOr(Schema.String.check(Schema.isMaxLength(16_384))),
    idToken: Schema.NonEmptyString.check(Schema.isMaxLength(16_384)),
    issuer: Schema.String,
    expiresAt: Schema.Finite,
    earliestRefreshAt: Schema.NullOr(Schema.Finite),
    scopes: Schema.Array(Schema.String),
    subject: Schema.String,
    email: Schema.NullOr(Schema.String),
  }),
});
export type ChatGptTransferredProfile = typeof ChatGptTransferredProfile.Type;
export const ChatGptReconnectProfileInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  methodId: Schema.String,
});
export const ChatGptImportProfileInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  profile: ChatGptTransferredProfile,
});
export const ChatGptHandoffInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  environmentId: EnvironmentId,
  attemptId: Schema.String.check(Schema.isMaxLength(128)),
  returnUrl: Schema.String.check(Schema.isMaxLength(4_096)),
  profile: Schema.NullOr(ChatGptReconnectProfile),
});
export type ChatGptHandoffInput = typeof ChatGptHandoffInput.Type;
export const ChatGptHandoffState = Schema.Union([
  Schema.Struct({ phase: Schema.Literal("auth"), state: ProviderAuthState }),
  Schema.Struct({ phase: Schema.Literal("finished"), profile: ChatGptTransferredProfile }),
]);
export type ChatGptHandoffState = typeof ChatGptHandoffState.Type;
