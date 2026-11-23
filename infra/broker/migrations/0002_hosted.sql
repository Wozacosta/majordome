-- One row per invite to a server Majordome hosts. An invite makes one server, once. The row
-- keeps the app it made, so the server can be found and removed, and so the cap counts it.
CREATE TABLE hosted_invites (
  code TEXT PRIMARY KEY,
  note TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  app_name TEXT,
  client_ip TEXT,
  removed_at INTEGER
);

CREATE UNIQUE INDEX hosted_invites_app ON hosted_invites (app_name) WHERE app_name IS NOT NULL;
