-- One row per wrong invite code tried, for the per-client limit on guessing. Rows older than a
-- day are dropped as new ones arrive.
CREATE TABLE hosted_invite_failures (
  client_ip TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX hosted_invite_failures_client ON hosted_invite_failures (client_ip, at);
