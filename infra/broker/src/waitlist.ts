import { BrokerError } from "./errors.ts";

/** The systems Majordome does not run on yet, and that a person can ask to hear about. */
const PLATFORMS = ["linux", "windows"] as const;
export type WaitlistPlatform = (typeof PLATFORMS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EMAIL_CHARS = 254;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface WaitlistStore {
  readonly addedByIp: (input: {
    readonly clientIp: string;
    readonly since: number;
  }) => Promise<number>;
  /** Adding an email already listed for a platform changes nothing. */
  readonly add: (row: {
    readonly email: string;
    readonly platform: WaitlistPlatform;
    readonly clientIp: string;
    readonly createdAt: number;
  }) => Promise<void>;
}

export interface WaitlistRequest {
  readonly email: unknown;
  readonly platforms: unknown;
  readonly clientIp: string;
}

const isPlatform = (value: unknown): value is WaitlistPlatform =>
  PLATFORMS.some((platform) => platform === value);

export function makeWaitlist(options: {
  readonly store: WaitlistStore;
  readonly now: () => number;
  readonly maxPerIpPerDay: number;
}) {
  return {
    join: async ({ email, platforms, clientIp }: WaitlistRequest): Promise<void> => {
      const address = typeof email === "string" ? email.trim().toLowerCase() : "";
      if (address.length > MAX_EMAIL_CHARS || !EMAIL.test(address)) {
        throw new BrokerError("invalid_request", "That does not look like an email address.");
      }
      if (!Array.isArray(platforms) || platforms.length === 0 || !platforms.every(isPlatform)) {
        throw new BrokerError("invalid_request", "Choose Linux, Windows or both.");
      }
      const createdAt = options.now();
      const added = await options.store.addedByIp({ clientIp, since: createdAt - DAY_MS });
      if (added >= options.maxPerIpPerDay) {
        throw new BrokerError("rate_limited", "Too many emails from here today. Try tomorrow.");
      }
      for (const platform of new Set(platforms)) {
        await options.store.add({ email: address, platform, clientIp, createdAt });
      }
    },
  };
}
