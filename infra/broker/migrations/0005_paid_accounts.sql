-- One row per signed-in account that has asked to pay for a server. It holds who has paid
-- (where, the provider's ids, how it stands) and the one server made for it. The row outlives the
-- server: billing facts are kept after the machine is deleted.
CREATE TABLE hosted_accounts (
  account_id TEXT PRIMARY KEY,
  -- A UUID handed to Apple with a purchase, so Apple's notices name the account.
  app_token TEXT NOT NULL,
  -- 'web' or 'apple'; NULL until something is bought.
  source TEXT,
  customer_id TEXT,
  subscription_id TEXT,
  -- 'none', 'active', 'past_due' or 'ended'.
  state TEXT NOT NULL DEFAULT 'none',
  period_end INTEGER,
  cancels INTEGER NOT NULL DEFAULT 0,
  app_name TEXT,
  claimed_at INTEGER,
  made_at INTEGER,
  stopped_at INTEGER,
  delete_at INTEGER,
  -- A stopped server switched back on for a while, so its owner can get their notes out.
  wake_until INTEGER,
  wakes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX hosted_accounts_token ON hosted_accounts (app_token);
CREATE UNIQUE INDEX hosted_accounts_app ON hosted_accounts (app_name) WHERE app_name IS NOT NULL;
CREATE INDEX hosted_accounts_subscription ON hosted_accounts (subscription_id);
CREATE INDEX hosted_accounts_customer ON hosted_accounts (customer_id);

-- One row per subscription bought: where, and on what kind of device the sign-up began.
CREATE TABLE purchases (
  subscription_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  source TEXT NOT NULL,
  started_on TEXT,
  at INTEGER NOT NULL
);

-- Payment notices already handled, so one delivered twice does nothing the second time.
CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
