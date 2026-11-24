import type { AddressRow, AddressStore } from "./broker.ts";
import type { InviteStore } from "./hosting.ts";
import type { WaitlistStore } from "./waitlist.ts";

const COLUMNS =
  "label, identity, port, tunnel_id, dns_record_id, client_ip, created_at, blocked, reaped_at";

interface StoredRow {
  readonly label: string;
  readonly identity: string;
  readonly port: number;
  readonly tunnel_id: string | null;
  readonly dns_record_id: string | null;
  readonly client_ip: string;
  readonly created_at: number;
  readonly blocked: number;
  readonly reaped_at: number | null;
}

const toRow = (row: StoredRow): AddressRow => ({
  label: row.label,
  identity: row.identity,
  port: row.port,
  tunnelId: row.tunnel_id,
  dnsRecordId: row.dns_record_id,
  clientIp: row.client_ip,
  createdAt: row.created_at,
  blocked: row.blocked !== 0,
  reapedAt: row.reaped_at,
});

const PATCH_COLUMNS = {
  port: "port",
  tunnelId: "tunnel_id",
  dnsRecordId: "dns_record_id",
} as const;

export function makeD1Store(db: D1Database): AddressStore {
  return {
    forIdentity: async (identity) => {
      const { results } = await db
        .prepare(`SELECT ${COLUMNS} FROM addresses WHERE identity = ?`)
        .bind(identity)
        .all<StoredRow>();
      const live = results.find((row) => row.reaped_at === null);
      return {
        live: live === undefined ? null : toRow(live),
        blocked: results.some((row) => row.blocked !== 0),
      };
    },
    usage: async ({ clientIp, since }) => {
      const counts = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM addresses WHERE reaped_at IS NULL) AS live,
             (SELECT COUNT(*) FROM addresses WHERE created_at > ?1 AND client_ip = ?2) AS by_ip,
             (SELECT COUNT(*) FROM addresses WHERE created_at > ?1) AS total`,
        )
        .bind(since, clientIp)
        .first<{ readonly live: number; readonly by_ip: number; readonly total: number }>();
      return {
        live: counts?.live ?? 0,
        createdByIp: counts?.by_ip ?? 0,
        createdTotal: counts?.total ?? 0,
      };
    },
    insert: async (row) => {
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO addresses (label, identity, port, client_ip, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(row.label, row.identity, row.port, row.clientIp, row.createdAt)
        .run();
      return result.meta.changes === 1;
    },
    update: async (label, patch) => {
      const entries = Object.entries(patch) as Array<[keyof typeof PATCH_COLUMNS, unknown]>;
      if (entries.length === 0) return;
      const assignments = entries.map(([key]) => `${PATCH_COLUMNS[key]} = ?`).join(", ");
      await db
        .prepare(`UPDATE addresses SET ${assignments} WHERE label = ?`)
        .bind(...entries.map(([, value]) => value), label)
        .run();
    },
    markReaped: async (label, at) => {
      await db.prepare("UPDATE addresses SET reaped_at = ? WHERE label = ?").bind(at, label).run();
    },
    listLive: async () => {
      const { results } = await db
        .prepare(`SELECT ${COLUMNS} FROM addresses WHERE reaped_at IS NULL`)
        .all<StoredRow>();
      return results.map(toRow);
    },
  };
}

export function makeD1InviteStore(db: D1Database): InviteStore {
  return {
    claim: async ({ code, appName, clientIp, at }) => {
      const result = await db
        .prepare(
          "UPDATE hosted_invites SET claimed_at = ?, app_name = ?, client_ip = ? WHERE code = ? AND claimed_at IS NULL",
        )
        .bind(at, appName, clientIp, code)
        .run();
      return result.meta.changes === 1;
    },
    release: async (code) => {
      await db
        .prepare(
          "UPDATE hosted_invites SET claimed_at = NULL, app_name = NULL, client_ip = NULL WHERE code = ?",
        )
        .bind(code)
        .run();
    },
    live: async () => {
      const row = await db
        .prepare(
          "SELECT COUNT(*) AS live FROM hosted_invites WHERE app_name IS NOT NULL AND removed_at IS NULL",
        )
        .first<{ live: number }>();
      return row?.live ?? 0;
    },
    liveNames: async () => {
      const { results } = await db
        .prepare(
          "SELECT app_name FROM hosted_invites WHERE app_name IS NOT NULL AND removed_at IS NULL",
        )
        .all<{ app_name: string }>();
      return results.map((row) => row.app_name);
    },
    failures: async ({ clientIp, since }) => {
      const row = await db
        .prepare(
          "SELECT COUNT(*) AS tried FROM hosted_invite_failures WHERE client_ip = ? AND at > ?",
        )
        .bind(clientIp, since)
        .first<{ tried: number }>();
      return row?.tried ?? 0;
    },
    recordFailure: async ({ clientIp, at, forgetBefore }) => {
      await db.batch([
        db.prepare("DELETE FROM hosted_invite_failures WHERE at <= ?").bind(forgetBefore),
        db
          .prepare("INSERT INTO hosted_invite_failures (client_ip, at) VALUES (?, ?)")
          .bind(clientIp, at),
      ]);
    },
  };
}

export function makeD1WaitlistStore(db: D1Database): WaitlistStore {
  return {
    addedByIp: async ({ clientIp, since }) => {
      const row = await db
        .prepare(
          "SELECT COUNT(*) AS added FROM platform_waitlist WHERE client_ip = ? AND created_at > ?",
        )
        .bind(clientIp, since)
        .first<{ added: number }>();
      return row?.added ?? 0;
    },
    add: async ({ email, platform, clientIp, createdAt }) => {
      await db
        .prepare(
          "INSERT OR IGNORE INTO platform_waitlist (email, platform, client_ip, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(email, platform, clientIp, createdAt)
        .run();
    },
  };
}
