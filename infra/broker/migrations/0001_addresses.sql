-- One row per address ever handed out. A reaped row stays as a tombstone so its
-- label is never given to anyone else, and so a block outlives the address.
CREATE TABLE addresses (
  label TEXT PRIMARY KEY,
  identity TEXT NOT NULL,
  port INTEGER NOT NULL,
  tunnel_id TEXT,
  dns_record_id TEXT,
  client_ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  reaped_at INTEGER
);

CREATE UNIQUE INDEX addresses_live_identity ON addresses (identity) WHERE reaped_at IS NULL;
CREATE INDEX addresses_identity ON addresses (identity);
CREATE INDEX addresses_created_at ON addresses (created_at);
