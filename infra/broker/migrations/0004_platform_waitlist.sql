-- People who asked on majord.me to hear when Majordome runs on Linux or Windows. One row per
-- email and system. The IP address only limits how many one visitor can add in a day.
CREATE TABLE platform_waitlist (
  email TEXT NOT NULL,
  platform TEXT NOT NULL,
  client_ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (email, platform)
);

CREATE INDEX platform_waitlist_ip ON platform_waitlist (client_ip, created_at);
