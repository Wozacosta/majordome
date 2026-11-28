-- How many notifications a computer (its key's identity) and a network sent in an hour, to limit
-- them. Nothing about a notification is kept: no device, no title, no text. Rows older than a
-- day are deleted by the hourly pass.
CREATE TABLE push_usage (
  key TEXT NOT NULL,
  hour INTEGER NOT NULL,
  sent INTEGER NOT NULL,
  PRIMARY KEY (key, hour)
);
