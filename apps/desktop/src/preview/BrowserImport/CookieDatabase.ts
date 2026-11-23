import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

export interface ImportedCookie {
  readonly url: string;
  readonly name: string;
  readonly value: string;
  /** Leave host-only cookies undefined; Electron widens any supplied domain and rejects __Host- cookies with one. */
  readonly domain: string | undefined;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly expirationDate: number | undefined;
  readonly sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
}

/**
 * Copies a cookie file and its SQLite side files to a temporary folder, for a browser that is open
 * and keeps the original locked. The copy is read like any other cookie file.
 */
export const copyCookieFiles = Effect.fn("CookieDatabase.copyCookieFiles")(function* (
  cookiePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "majordome-site-cookies-",
  });
  const target = path.join(directory, path.basename(cookiePath));
  yield* fileSystem.copyFile(cookiePath, target);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    yield* fileSystem.copyFile(`${cookiePath}${suffix}`, `${target}${suffix}`).pipe(Effect.ignore);
  }
  return target;
});

export interface CookieReadResult {
  readonly cookies: ReadonlyArray<ImportedCookie>;
  readonly undecryptable: number;
  readonly undecryptableHosts: ReadonlyArray<string>;
}

export const cookieScope = (
  host: string,
  path: string,
  secure: boolean,
): { readonly url: string; readonly domain: string | undefined } => {
  const isDomainCookie = host.startsWith(".");
  const unwrappedHost = bareHost(host);
  const authority =
    unwrappedHost.includes(":") && !(unwrappedHost.startsWith("[") && unwrappedHost.endsWith("]"))
      ? `[${unwrappedHost}]`
      : unwrappedHost;
  return {
    url: `${secure ? "https" : "http"}://${authority}${path}`,
    domain: isDomainCookie ? host : undefined,
  };
};

export const bareHost = (host: string): string => (host.startsWith(".") ? host.slice(1) : host);

/** Copy before reading to avoid live WAL writes and never open the source browser database for writing. */
export const snapshotCookieDatabase = Effect.fn("CookieDatabase.snapshotCookieDatabase")(function* (
  cookiePath: string,
  tempPrefix = "t3code-cookie-import-",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: tempPrefix });
  const target = path.join(directory, path.basename(cookiePath));
  yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`VACUUM INTO ${target}`;
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: cookiePath, readonly: true })));
  return target;
});

/** A cookie as another browser takes it: `domain` keeps its leading dot, or names the one host. */
export interface SiteCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly expires?: number;
  readonly sameSite?: "Strict" | "Lax" | "None";
}

const SAME_SITE: Record<ImportedCookie["sameSite"], SiteCookie["sameSite"]> = {
  unspecified: undefined,
  no_restriction: "None",
  lax: "Lax",
  strict: "Strict",
};

/**
 * The cookies a browser would send to `host`: its own, and those a parent domain shares with its
 * subdomains. Never a sibling's or a subdomain's, and none already expired at `nowSeconds`.
 */
export function importedCookiesForHost(
  cookies: ReadonlyArray<ImportedCookie>,
  host: string,
  nowSeconds: number,
): ReadonlyArray<ImportedCookie> {
  const wanted = host.trim().toLowerCase().replace(/\.$/, "");
  if (wanted === "") return [];
  return cookies.filter((cookie) => {
    let ownHost: string;
    try {
      ownHost = new URL(cookie.url).hostname.toLowerCase();
    } catch {
      return false;
    }
    const shared = cookie.domain === undefined ? null : bareHost(cookie.domain).toLowerCase();
    const sent =
      shared === null
        ? ownHost === wanted
        : shared === wanted || (shared.includes(".") && wanted.endsWith(`.${shared}`));
    return sent && (cookie.expirationDate === undefined || cookie.expirationDate > nowSeconds);
  });
}

/** The same cookies, shaped for a browser on another computer. */
export function cookiesForHost(
  cookies: ReadonlyArray<ImportedCookie>,
  host: string,
  nowSeconds: number,
): ReadonlyArray<SiteCookie> {
  return importedCookiesForHost(cookies, host, nowSeconds).map((cookie) => {
    const sameSite = SAME_SITE[cookie.sameSite];
    return {
      name: cookie.name,
      value: cookie.value,
      domain:
        cookie.domain === undefined
          ? new URL(cookie.url).hostname.toLowerCase()
          : `.${bareHost(cookie.domain).toLowerCase()}`,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      ...(cookie.expirationDate === undefined ? {} : { expires: cookie.expirationDate }),
      ...(sameSite === undefined ? {} : { sameSite }),
    };
  });
}
