import { BrokerError } from "./errors.ts";

/** What the hosting provider must do. One implementation per host; Fly.io is the first. */
export interface HostClient {
  /** Makes the server and its address. Throws `HostError`; nothing is left half-made. */
  readonly createServer: (input: {
    readonly name: string;
    readonly env: Readonly<Record<string, string>>;
    readonly image: string;
  }) => Promise<{ readonly url: string }>;
  readonly deleteServer: (name: string) => Promise<void>;
  /** Where a server of that name answers. */
  readonly urlFor: (name: string) => string;
  /** Whether the machine itself runs yet, which comes before Majordome answers on it. */
  readonly isSwitchedOn: (name: string) => Promise<boolean>;
  /** Restarts the server on that image. Its notes and sign-ins are kept. */
  readonly updateServer: (name: string, image: string) => Promise<void>;
}

export class HostError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface InviteStore {
  /** Marks an unclaimed invite as taken by `appName`. False when unknown or already used. */
  readonly claim: (input: {
    readonly code: string;
    readonly appName: string;
    readonly clientIp: string;
    readonly at: number;
  }) => Promise<boolean>;
  /** Gives the invite back after a server could not be made. */
  readonly release: (code: string) => Promise<void>;
  /** Servers made and not removed. */
  readonly live: () => Promise<number>;
  readonly liveNames: () => Promise<ReadonlyArray<string>>;
  /** Wrong codes that client has tried since then. */
  readonly failures: (input: {
    readonly clientIp: string;
    readonly since: number;
  }) => Promise<number>;
  /** Notes a wrong code, and forgets the ones tried before `forgetBefore`. */
  readonly recordFailure: (input: {
    readonly clientIp: string;
    readonly at: number;
    readonly forgetBefore: number;
  }) => Promise<void>;
}

export interface HostedServer {
  readonly name: string;
  readonly url: string;
  /** Opens the server paired as its owner. Works once, for a day. */
  readonly pairingUrl: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_LENGTH = 10;
// No 0/o, 1/l/i: the address is read aloud and typed by hand.
const NAME_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SETUP_SECRET_TTL_MS = DAY_MS;
const MAX_INVITE_CHARS = 64;
const MAX_WRONG_INVITES_PER_IP_PER_DAY = 10;

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

/** The server's own one-time secret format: see `serverSetupSecret.ts` in the server. */
export const setupSecret = (expiresAtMs: number, random: Uint8Array) =>
  `mjsetup-${Math.floor(expiresAtMs / 1000)}-${base64Url(random)}`;

/** True for a name `serverName` could have made, so a caller cannot point the service elsewhere. */
export const isServerName = (prefix: string, name: string) =>
  name.startsWith(prefix) &&
  name.length === prefix.length + NAME_LENGTH &&
  Array.from(name.slice(prefix.length)).every((character) => NAME_ALPHABET.includes(character));

export function serverName(prefix: string, random: Uint8Array): string {
  let name = "";
  for (const byte of random) name += NAME_ALPHABET[byte % NAME_ALPHABET.length];
  return `${prefix}${name}`;
}

export function makeHosting(deps: {
  readonly invites: InviteStore;
  readonly host: HostClient;
  /** The image a new server runs, named by its digest. Throws `HostError` when it is not known. */
  readonly image: () => Promise<string>;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly config: { readonly namePrefix: string; readonly maxServers: number };
}) {
  return {
    /** Spends an invite on a new server. The invite is given back if the server is not made. */
    create: async (input: {
      readonly invite: string;
      readonly clientIp: string;
      /** The signed-in account the server belongs to from its first start, when there is one. */
      readonly ownerAccountId?: string;
    }): Promise<HostedServer> => {
      const code = input.invite.trim();
      if (code === "" || code.length > MAX_INVITE_CHARS) {
        throw new BrokerError("invalid_invite", "That invite code is not valid.");
      }
      const at = deps.now();
      const tried = await deps.invites.failures({ clientIp: input.clientIp, since: at - DAY_MS });
      if (tried >= MAX_WRONG_INVITES_PER_IP_PER_DAY) {
        throw new BrokerError("rate_limited", "Too many wrong invite codes. Try again tomorrow.");
      }
      if ((await deps.invites.live()) >= deps.config.maxServers) {
        throw new BrokerError(
          "full",
          "Majordome is not taking new servers right now. Try again later.",
        );
      }
      const name = serverName(deps.config.namePrefix, deps.randomBytes(NAME_LENGTH));
      if (!(await deps.invites.claim({ code, appName: name, clientIp: input.clientIp, at }))) {
        await deps.invites.recordFailure({
          clientIp: input.clientIp,
          at,
          forgetBefore: at - DAY_MS,
        });
        // The same answer for an unknown code and a spent one, so codes cannot be probed.
        throw new BrokerError("invalid_invite", "That invite code is not valid, or was used.");
      }
      const secret = setupSecret(at + SETUP_SECRET_TTL_MS, deps.randomBytes(32));
      try {
        const { url } = await deps.host.createServer({
          name,
          image: await deps.image(),
          env: {
            MAJORDOME_HOSTED: "1",
            MAJORDOME_SETUP_SECRET: secret,
            ...(input.ownerAccountId === undefined
              ? {}
              : { MAJORDOME_OWNER_ACCOUNT: input.ownerAccountId }),
          },
        });
        return { name, url, pairingUrl: `${url}/pair#token=${secret}` };
      } catch (error) {
        await deps.host.deleteServer(name).catch(() => undefined);
        await deps.invites.release(code);
        throw error;
      }
    },
  };
}

/** "0.10.30" from a release address such as `.../releases/tag/v0.10.30`; null for anything else. */
export const releaseVersion = (location: string | null) =>
  /\/releases\/tag\/v(\d+\.\d+\.\d+)$/u.exec(location ?? "")?.[1] ?? null;

/**
 * The released image by its digest, which a moved tag cannot change. `digest` is what the release
 * carries in `image-digest.txt`; null when that is not a digest.
 */
export function imageByDigest(repository: string, digest: string): string | null {
  const trimmed = digest.trim();
  if (!/^sha256:[0-9a-f]{64}$/u.test(trimmed)) return null;
  return `${repository.replace(/[:@][^/]*$/u, "")}@${trimmed}`;
}

/**
 * How far a new server has come: switched on, then answering. Only for a server this service
 * made and still lists, so nobody can have it ask the host about other names.
 */
export async function serverProgress(deps: {
  readonly name: string;
  readonly namePrefix: string;
  readonly liveNames: () => Promise<ReadonlyArray<string>>;
  readonly host: Pick<HostClient, "isSwitchedOn">;
  readonly answers: (name: string) => Promise<boolean>;
}): Promise<{ readonly switchedOn: boolean; readonly ready: boolean }> {
  if (!isServerName(deps.namePrefix, deps.name) || !(await deps.liveNames()).includes(deps.name)) {
    return { switchedOn: false, ready: false };
  }
  if (await deps.answers(deps.name)) return { switchedOn: true, ready: true };
  return { switchedOn: await deps.host.isSwitchedOn(deps.name).catch(() => false), ready: false };
}

export interface UpdateReport {
  readonly updated: ReadonlyArray<string>;
  readonly current: number;
  /** Servers that did not answer, or that the host refused to update. Tried again next time. */
  readonly skipped: ReadonlyArray<string>;
}

/**
 * Brings every hosted server to the latest release and its image. A server is restarted only when
 * it reports another version, so a day with no release restarts nothing.
 */
export async function updateServers(deps: {
  readonly names: ReadonlyArray<string>;
  readonly host: Pick<HostClient, "updateServer">;
  readonly latestVersion: string;
  readonly image: string;
  /** The version a server reports, or null while it does not answer. */
  readonly versionOf: (name: string) => Promise<string | null>;
}): Promise<UpdateReport> {
  const updated: Array<string> = [];
  const skipped: Array<string> = [];
  let current = 0;
  for (const name of deps.names) {
    const version = await deps.versionOf(name);
    if (version === deps.latestVersion) {
      current += 1;
    } else if (version === null) {
      skipped.push(name);
    } else {
      await deps.host.updateServer(name, deps.image).then(
        () => updated.push(name),
        () => skipped.push(name),
      );
    }
  }
  return { updated, current, skipped };
}

export type Hosting = ReturnType<typeof makeHosting>;
