import type {
  BrowserImportInput,
  BrowserImportResult,
  BrowserImportSource,
  BrowserImportUnavailableReason,
  BrowserSiteCookiesResult,
  DesktopPreviewReadSiteCookiesInput,
} from "@t3tools/contracts";
import {
  BROWSER_SITE_COOKIES_MAX,
  BrowserImportFailureReason,
  type ManagedPolicyDocument,
  managedPolicyDeniedMessage,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import type { Session } from "electron";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/process";

import * as HostProcess from "@t3tools/shared/HostProcess";
import type { ManagedPolicyFileError } from "@t3tools/shared/managedPolicyFile";

import * as DesktopManagedPolicy from "../../app/DesktopManagedPolicy.ts";
import * as BrowserSession from "../BrowserSession.ts";
import { ChromiumCookieReadError, readChromiumCookies } from "./ChromiumCookies.ts";
import { cookiesForHost, copyCookieFiles, type CookieReadResult } from "./CookieDatabase.ts";
import { FirefoxCookieReadError, readFirefoxCookies } from "./FirefoxCookies.ts";
import { readSafariCookies, safariAccessDenied, SafariCookieReadError } from "./SafariCookies.ts";
import {
  BROWSER_IMPORT_SOURCES,
  resolveCookieDatabase,
  isSourceInstalled,
  isSourceRunning,
  listSourceProfiles,
  sourcePathContext,
  type BrowserImportPathContext,
  type BrowserImportSourceDefinition,
} from "./Sources.ts";

export class BrowserImportFailedError extends Schema.TaggedError<BrowserImportFailedError>()(
  "BrowserImportFailedError",
  {
    sourceId: Schema.String,
    reason: BrowserImportFailureReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // IPC preserves only the message; the renderer needs its reason token for user-facing copy.
  override get message(): string {
    return `Importing cookies from ${this.sourceId} failed: ${this.reason}.`;
  }
}

/** An administrator's policy forbids the import, or the policy file could not be checked. */
export class BrowserImportPolicyError extends Schema.TaggedError<BrowserImportPolicyError>()(
  "BrowserImportPolicyError",
  {
    policyPath: Schema.String,
    /** Absent when the policy could not be read or decoded. */
    organization: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.organization === undefined
      ? `The managed policy at ${this.policyPath} could not be read, so importing browser cookies is not allowed.`
      : managedPolicyDeniedMessage(this.organization, "importing browser cookies");
  }
}

/**
 * A policy that cannot be read or decoded denies the import: cookies are credentials, and the
 * server refuses to start on the same policy anyway.
 */
export const checkBrowserImportPolicy = Effect.fn("BrowserImport.checkPolicy")(function* <R>(
  readPolicy: Effect.Effect<
    { readonly source: string; readonly document: ManagedPolicyDocument } | undefined,
    ManagedPolicyFileError,
    R
  >,
) {
  const policy = yield* readPolicy.pipe(
    Effect.mapError((cause) => new BrowserImportPolicyError({ policyPath: cause.path, cause })),
  );
  if (policy?.document.limits?.browserCookieImport === false) {
    return yield* new BrowserImportPolicyError({
      policyPath: policy.source,
      organization: policy.document.organization,
    });
  }
});

class BrowserCookieFlushError extends Schema.TaggedError<BrowserCookieFlushError>()(
  "BrowserCookieFlushError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Imported cookies could not be flushed to disk.";
  }
}

export class BrowserCookieWriteError extends Schema.TaggedError<BrowserCookieWriteError>()(
  "BrowserCookieWriteError",
  {
    url: Schema.String,
    cookieName: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not write imported cookie ${this.cookieName} for ${this.url}.`;
  }
}

export class BrowserImport extends Context.Service<
  BrowserImport,
  {
    readonly listSources: Effect.Effect<ReadonlyArray<BrowserImportSource>>;
    readonly importCookies: (input: {
      readonly input: BrowserImportInput;
      readonly scope: string;
      readonly persistent: boolean;
      readonly namespace?: BrowserSession.BrowserSessionPartitionNamespace;
    }) => Effect.Effect<BrowserImportResult, BrowserImportFailedError | BrowserImportPolicyError>;
    /** One site's cookies from one of the owner's browsers, which may be open. Nothing is written. */
    readonly readSiteCookies: (
      input: DesktopPreviewReadSiteCookiesInput,
    ) => Effect.Effect<
      BrowserSiteCookiesResult,
      BrowserImportFailedError | BrowserImportPolicyError
    >;
  }
>()("@t3tools/desktop/preview/BrowserImport/BrowserImport") {}

const unavailableReason = Effect.fn("BrowserImport.unavailableReason")(function* (
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
): Effect.fn.Return<
  BrowserImportUnavailableReason | undefined,
  never,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> {
  if (!definition.platforms.includes(context.platform)) return "unsupportedPlatform";
  if (!(yield* isSourceInstalled(definition, context))) return "notInstalled";
  if (yield* isSourceRunning(definition, context)) return "browserRunning";
  // TCC permits stat without Full Disk Access, so a listed Safari jar may still be unreadable.
  if (definition.engine === "safari") {
    const jar = yield* resolveCookieDatabase(definition, context, ".");
    if (jar !== undefined && (yield* safariAccessDenied(jar))) return "needsFullDiskAccess";
  }
  return undefined;
});

const cookieHost = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

export const writeCookies = Effect.fn("BrowserImport.writeCookies")(function* (
  session: { readonly cookies: Pick<Session["cookies"], "set" | "flushStore"> },
  read: CookieReadResult,
) {
  let imported = 0;
  let skipped = read.undecryptable;
  const skippedDomains = new Set(read.undecryptableHosts);
  for (const cookie of read.cookies) {
    const written = yield* Effect.tryPromise({
      try: () =>
        session.cookies.set({
          url: cookie.url,
          name: cookie.name,
          value: cookie.value,
          // Electron widens any supplied domain; omit it for host-only cookies.
          ...(cookie.domain === undefined ? {} : { domain: cookie.domain }),
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
        }),
      catch: (cause) =>
        new BrowserCookieWriteError({ url: cookie.url, cookieName: cookie.name, cause }),
    }).pipe(
      Effect.as(true),
      Effect.tapError((error) => Effect.logDebug(error.message, { cause: error.cause })),
      Effect.catchTags({ BrowserCookieWriteError: () => Effect.succeed(false) }),
    );
    if (written) {
      imported += 1;
    } else {
      skipped += 1;
      skippedDomains.add(cookieHost(cookie.url));
    }
  }
  // Cookie writes settle in memory; flush to disk before reporting a durable import.
  if (imported > 0) {
    yield* Effect.tryPromise({
      try: () => session.cookies.flushStore(),
      catch: (cause) => new BrowserCookieFlushError({ cause }),
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Imported cookies could not be flushed to disk", { cause: error.cause }),
      ),
      Effect.ignore,
    );
  }
  return { imported, skipped, skippedDomains: [...skippedDomains].slice(0, 20) };
});

/** @public */
export const make = Effect.gen(function* BrowserImportMake() {
  const browserSession = yield* BrowserSession.BrowserSession;
  const managedPolicy = yield* DesktopManagedPolicy.DesktopManagedPolicy;
  const platform = yield* HostProcess.Platform;
  const executablePath = yield* HostProcess.ExecutablePath;
  const platformServices = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  >();
  const pathContext = yield* sourcePathContext;

  const listSources: Effect.Effect<ReadonlyArray<BrowserImportSource>> = Effect.forEach(
    BROWSER_IMPORT_SOURCES,
    Effect.fnUntraced(function* (definition) {
      const unavailable = yield* unavailableReason(definition, pathContext);
      return {
        id: definition.id,
        name: definition.name,
        // An open browser keeps its profiles listed: one site's cookies can be read from a copy.
        profiles:
          unavailable === undefined || unavailable === "browserRunning"
            ? yield* listSourceProfiles(definition, pathContext)
            : [],
        ...(unavailable === undefined ? {} : { unavailable }),
      } satisfies BrowserImportSource;
    }),
  ).pipe(Effect.provide(platformServices));

  /** Reads every cookie of one of the owner's browser profiles, decrypted. */
  const readSource = Effect.fn("BrowserImport.readSource")(function* (input: {
    readonly input: Pick<BrowserImportInput, "sourceId" | "sourceProfileDirectory">;
    /** Read a copy of the cookie file when the browser is open, instead of refusing. */
    readonly whileRunning: boolean;
  }) {
    yield* checkBrowserImportPolicy(managedPolicy.read);
    const definition = BROWSER_IMPORT_SOURCES.find(
      (candidate) => candidate.id === input.input.sourceId,
    );
    if (!definition) {
      return yield* new BrowserImportFailedError({
        sourceId: input.input.sourceId,
        reason: "unknownSource",
      });
    }

    const blocked = yield* unavailableReason(definition, pathContext).pipe(
      Effect.provide(platformServices),
    );
    const running = blocked === "browserRunning";
    if (blocked !== undefined && !(running && input.whileRunning)) {
      return yield* new BrowserImportFailedError({ sourceId: definition.id, reason: blocked });
    }

    if (platform === "darwin" && definition.engine === "chromium") {
      // macOS attributes Keychain prompts and ACL grants to the executable, which differs in dev and packaged builds.
      yield* Effect.logInfo("Reading browser cookie key from the keychain", {
        sourceId: definition.id,
        executablePath,
      });
    }

    // IPC profile paths must match the source's listing to prevent traversal outside browser user-data.
    const sourceProfiles = yield* listSourceProfiles(definition, pathContext).pipe(
      Effect.provide(platformServices),
    );
    const requestedProfile = sourceProfiles.find(
      (profile) => profile.directory === input.input.sourceProfileDirectory,
    );
    if (requestedProfile === undefined) {
      return yield* new BrowserImportFailedError({
        sourceId: definition.id,
        reason: "unknownSourceProfile",
      });
    }

    // Re-resolve listed paths because Chromium jars may be under Network/.
    const databasePath = yield* resolveCookieDatabase(
      definition,
      pathContext,
      requestedProfile.directory,
    ).pipe(Effect.provide(platformServices));
    if (databasePath === undefined) {
      return yield* new BrowserImportFailedError({ sourceId: definition.id, reason: "readFailed" });
    }

    // An open browser locks its cookie file, so a copy made beside nothing else is read instead.
    const readablePath = running
      ? copyCookieFiles(databasePath).pipe(
          Effect.provide(platformServices),
          Effect.mapError(
            (cause) =>
              new BrowserImportFailedError({
                sourceId: definition.id,
                reason: "readFailed",
                cause,
              }),
          ),
        )
      : Effect.succeed(databasePath);

    const userDataDirectory = definition.userDataDirectory(pathContext);
    const read = (
      cookiePath: string,
    ): Effect.Effect<
      CookieReadResult,
      ChromiumCookieReadError | FirefoxCookieReadError | SafariCookieReadError,
      FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
    > =>
      definition.engine === "safari"
        ? readSafariCookies(cookiePath).pipe(
            Effect.map((cookies) => ({ cookies, undecryptable: 0, undecryptableHosts: [] })),
          )
        : definition.engine === "firefox"
          ? readFirefoxCookies(cookiePath).pipe(
              Effect.map((cookies) => ({ cookies, undecryptable: 0, undecryptableHosts: [] })),
            )
          : readChromiumCookies({
              cookieDatabasePath: cookiePath,
              keychainService: definition.keychainService,
              keychainAccount: definition.keychainAccount,
              linuxSecretApplication: definition.linuxSecretApplication,
              ...(platform === "win32" && userDataDirectory !== undefined
                ? {
                    windowsLocalStatePath: pathContext.path.join(userDataDirectory, "Local State"),
                  }
                : {}),
              platform,
            });

    return yield* readablePath.pipe(
      Effect.flatMap(read),
      Effect.scoped,
      Effect.provide(platformServices),
      Effect.catchTags({
        ChromiumCookieReadError: (cause) =>
          Effect.fail(
            new BrowserImportFailedError({ sourceId: definition.id, reason: cause.reason, cause }),
          ),
        FirefoxCookieReadError: (cause) =>
          Effect.fail(
            new BrowserImportFailedError({ sourceId: definition.id, reason: "readFailed", cause }),
          ),
        SafariCookieReadError: (cause) =>
          Effect.fail(
            new BrowserImportFailedError({ sourceId: definition.id, reason: cause.reason, cause }),
          ),
      }),
    );
  });

  const importCookies = Effect.fn("BrowserImport.importCookies")(function* (input: {
    readonly input: BrowserImportInput;
    readonly scope: string;
    readonly persistent: boolean;
    readonly namespace?: BrowserSession.BrowserSessionPartitionNamespace;
  }) {
    const result = yield* readSource({ input: input.input, whileRunning: false });

    const session = yield* browserSession
      .getSession(input.scope, input.persistent, input.namespace)
      .pipe(
        Effect.mapError(
          (cause) =>
            new BrowserImportFailedError({
              sourceId: input.input.sourceId,
              reason: "sessionUnavailable",
              cause,
            }),
        ),
      );

    // Chromium serializes writes; a rejected cookie should not prevent the others.
    return yield* writeCookies(session, result);
  });

  const readSiteCookies = Effect.fn("BrowserImport.readSiteCookies")(function* (
    input: DesktopPreviewReadSiteCookiesInput,
  ) {
    const read = yield* readSource({ input, whileRunning: true });
    const now = yield* Clock.currentTimeMillis;
    const wanted = cookiesForHost(read.cookies, input.host, Math.floor(now / 1000));
    return {
      cookies: wanted.slice(0, BROWSER_SITE_COOKIES_MAX),
      undecryptable: cookiesForHost(
        read.undecryptableHosts.map((host) => ({
          url: `https://${host}/`,
          name: "",
          value: "",
          domain: `.${host}`,
          path: "/",
          secure: true,
          httpOnly: false,
          expirationDate: undefined,
          sameSite: "unspecified" as const,
        })),
        input.host,
        0,
      ).length,
    } satisfies BrowserSiteCookiesResult;
  });

  return BrowserImport.of({ listSources, importCookies, readSiteCookies });
});

export const layer = Layer.effect(BrowserImport, make);
