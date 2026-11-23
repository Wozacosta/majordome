import { BrokerError } from "./errors.ts";

/** What the hosting provider must do. One implementation per host; Fly.io is the first. */
export interface HostClient {
  /** Makes the server and its address. Throws `HostError`; nothing is left half-made. */
  readonly createServer: (input: {
    readonly name: string;
    readonly env: Readonly<Record<string, string>>;
  }) => Promise<{ readonly url: string }>;
  readonly deleteServer: (name: string) => Promise<void>;
  /** Where a server of that name answers. */
  readonly urlFor: (name: string) => string;
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
}

export interface HostedServer {
  readonly name: string;
  readonly url: string;
  /** Opens the server paired as its owner. Works once, for a day. */
  readonly pairingUrl: string;
}

const NAME_LENGTH = 10;
// No 0/o, 1/l/i: the address is read aloud and typed by hand.
const NAME_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SETUP_SECRET_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_INVITE_CHARS = 64;

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
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly config: { readonly namePrefix: string; readonly maxServers: number };
}) {
  return {
    /** Spends an invite on a new server. The invite is given back if the server is not made. */
    create: async (input: {
      readonly invite: string;
      readonly clientIp: string;
    }): Promise<HostedServer> => {
      const code = input.invite.trim();
      if (code === "" || code.length > MAX_INVITE_CHARS) {
        throw new BrokerError("invalid_invite", "That invite code is not valid.");
      }
      if ((await deps.invites.live()) >= deps.config.maxServers) {
        throw new BrokerError(
          "full",
          "Majordome is not taking new servers right now. Try again later.",
        );
      }
      const name = serverName(deps.config.namePrefix, deps.randomBytes(NAME_LENGTH));
      const at = deps.now();
      if (!(await deps.invites.claim({ code, appName: name, clientIp: input.clientIp, at }))) {
        // The same answer for an unknown code and a spent one, so codes cannot be probed.
        throw new BrokerError("invalid_invite", "That invite code is not valid, or was used.");
      }
      const secret = setupSecret(at + SETUP_SECRET_TTL_MS, deps.randomBytes(32));
      try {
        const { url } = await deps.host.createServer({
          name,
          env: { MAJORDOME_HOSTED: "1", MAJORDOME_SETUP_SECRET: secret },
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

export type Hosting = ReturnType<typeof makeHosting>;
