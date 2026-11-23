/**
 * The servers of a Majordome account. The list lives in the account itself, in the part of it
 * only its holder can write, so no service of ours keeps who owns which server.
 */

export interface AccountServer {
  readonly environmentId: string;
  /** Where the account's other devices reach the server. */
  readonly url: string;
  readonly name: string;
}

/** The key under the account's own metadata. */
const ACCOUNT_SERVERS_KEY = "majordomeServers";
const MAX_SERVERS = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reached over HTTPS, or, where a developer allows it, a server on this very machine. */
function isReachable(value: string, allowThisMachine: boolean): boolean {
  const url = URL.parse(value);
  if (url === null) return false;
  const onThisMachine =
    url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  return url.protocol === "https:" || (allowThisMachine && onThisMachine);
}

function readServer(value: unknown, allowThisMachine: boolean): AccountServer | null {
  if (!isRecord(value)) return null;
  const { environmentId, url, name } = value;
  if (typeof environmentId !== "string" || environmentId === "") return null;
  if (typeof url !== "string" || !isReachable(url, allowThisMachine)) return null;
  return { environmentId, url, name: typeof name === "string" && name !== "" ? name : url };
}

/** What the account lists, leaving out anything that is not a server reached over HTTPS. */
export function readAccountServers(
  metadata: unknown,
  /** Development builds also list a server on the developer's own machine. */
  options: { readonly allowThisMachine?: boolean } = {},
): ReadonlyArray<AccountServer> {
  const listed = isRecord(metadata) ? metadata[ACCOUNT_SERVERS_KEY] : undefined;
  if (!Array.isArray(listed)) return [];
  const servers = new Map<string, AccountServer>();
  for (const value of listed) {
    const server = readServer(value, options.allowThisMachine === true);
    if (server !== null) servers.set(server.environmentId, server);
  }
  return Array.from(servers.values()).slice(0, MAX_SERVERS);
}

/** The account's metadata with `server` listed, replacing what was listed for the same server. */
export function withAccountServer(metadata: unknown, server: AccountServer) {
  const others = readAccountServers(metadata).filter(
    (listed) => listed.environmentId !== server.environmentId,
  );
  return {
    ...(isRecord(metadata) ? metadata : {}),
    [ACCOUNT_SERVERS_KEY]: [...others, server].slice(-MAX_SERVERS),
  };
}

export function withoutAccountServer(metadata: unknown, environmentId: string) {
  return {
    ...(isRecord(metadata) ? metadata : {}),
    [ACCOUNT_SERVERS_KEY]: readAccountServers(metadata).filter(
      (listed) => listed.environmentId !== environmentId,
    ),
  };
}

/** The account service's token template whose tokens a Majordome server accepts. */
export const ACCOUNT_TOKEN_OPTIONS = { template: "majordome", skipCache: true } as const;

const accountServerSilent = (name: string) =>
  `${name} did not answer. Check that it is on and connected to the internet, then try again.`;
const accountServerRefused = (name: string) =>
  `${name} did not let you in. Sign out, sign in again, then try once more.`;

export type AccountSignIn =
  | { readonly ok: true; readonly credential: string }
  | { readonly ok: false; readonly message: string };

/**
 * Shows `server` a fresh account token and gets the one-time code its pairing takes. `path` is
 * `MAJORDOME_ACCOUNT_SIGN_IN_PATH`; this package cannot import the contracts.
 */
export async function signInToAccountServer(input: {
  readonly server: AccountServer;
  readonly token: string;
  readonly path: string;
  /** The app's own `fetch`; this package makes no requests of its own. */
  readonly request: (url: URL, init: RequestInit) => Promise<Response>;
}): Promise<AccountSignIn> {
  const { server } = input;
  const response = await input
    .request(new URL(input.path, server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: input.token }),
    })
    .catch(() => null);
  if (response === null) {
    return { ok: false, message: accountServerSilent(server.name) };
  }
  const body: unknown = await response.json().catch(() => null);
  const read = (key: string) => {
    const value = typeof body === "object" && body !== null ? Reflect.get(body, key) : null;
    return typeof value === "string" ? value : null;
  };
  const credential = read("credential");
  return response.ok && credential !== null
    ? { ok: true, credential }
    : { ok: false, message: read("message") ?? accountServerRefused(server.name) };
}
