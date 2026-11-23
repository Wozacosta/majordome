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

function readServer(value: unknown): AccountServer | null {
  if (!isRecord(value)) return null;
  const { environmentId, url, name } = value;
  if (typeof environmentId !== "string" || environmentId === "") return null;
  if (typeof url !== "string" || URL.parse(url)?.protocol !== "https:") return null;
  return { environmentId, url, name: typeof name === "string" && name !== "" ? name : url };
}

/** What the account lists, leaving out anything that is not a server reached over HTTPS. */
export function readAccountServers(metadata: unknown): ReadonlyArray<AccountServer> {
  const listed = isRecord(metadata) ? metadata[ACCOUNT_SERVERS_KEY] : undefined;
  if (!Array.isArray(listed)) return [];
  const servers = new Map<string, AccountServer>();
  for (const value of listed) {
    const server = readServer(value);
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
