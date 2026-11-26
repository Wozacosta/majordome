import { BrokerError } from "./errors.ts";

/** What the owner's page does with invites: list them, make one, take back an unused one. */

export interface InviteRow {
  readonly code: string;
  readonly note: string | null;
  readonly createdAt: number;
  readonly claimedAt: number | null;
  readonly appName: string | null;
  readonly removedAt: number | null;
}

export interface InviteAdminStore {
  readonly list: () => Promise<ReadonlyArray<InviteRow>>;
  readonly add: (input: {
    readonly code: string;
    readonly note: string;
    readonly at: number;
  }) => Promise<void>;
  /** Deletes an invite nobody has used. False when it is unknown or used. */
  readonly remove: (code: string) => Promise<boolean>;
}

const MAX_NOTE_CHARS = 120;
// The code is all that stands between a stranger and a server on the bill: 128 random bits.
const CODE_BYTES = 16;

/** The accounts named in `ADMIN_ACCOUNT_IDS`, a comma-separated list. */
export const adminAccounts = (value: string | undefined): ReadonlySet<string> =>
  new Set(
    (value ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
  );

export function makeInviteAdmin(deps: {
  readonly store: InviteAdminStore;
  /** Where a server answers; null while no host is set up. */
  readonly urlFor: ((name: string) => string) | null;
  /** Servers that count toward the cap, from invites and paid for. */
  readonly servers: () => Promise<number>;
  readonly maxServers: number;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
}) {
  return {
    list: async () => ({
      invites: (await deps.store.list())
        .toSorted((a, b) => b.createdAt - a.createdAt)
        .map((row) => ({
          ...row,
          url:
            row.appName === null || row.removedAt !== null || deps.urlFor === null
              ? null
              : deps.urlFor(row.appName),
        })),
      servers: await deps.servers(),
      maxServers: deps.maxServers,
    }),
    create: async (note: string | undefined) => {
      const trimmed = (note ?? "").trim();
      if (trimmed === "" || trimmed.length > MAX_NOTE_CHARS) {
        throw new BrokerError(
          "invalid_request",
          `Say who the invite is for, in ${MAX_NOTE_CHARS} characters at most.`,
        );
      }
      const code = Array.from(deps.randomBytes(CODE_BYTES), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      await deps.store.add({ code, note: trimmed, at: deps.now() });
      return { code };
    },
    revoke: async (code: string | undefined) => {
      if (code === undefined || !(await deps.store.remove(code))) {
        throw new BrokerError("invalid_invite", "That invite was used, or is already gone.");
      }
    },
  };
}

export type InviteAdmin = ReturnType<typeof makeInviteAdmin>;
