-- Billing identities are separate from authentication ids in Stripe metadata.
CREATE TABLE IF NOT EXISTS billing_accounts (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  app_user_ref TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  provider_mode TEXT CHECK (provider_mode IN ('live', 'test')),
  customer_started_at INTEGER,
  checkout_session_id TEXT,
  checkout_plan TEXT,
  checkout_generation INTEGER NOT NULL DEFAULT 0,
  checkout_started_at INTEGER,
  checkout_expires_at INTEGER,
  lock_token TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0,
  deleting INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  status TEXT NOT NULL,
  paid_through INTEGER NOT NULL DEFAULT 0,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER NOT NULL,
  eligible INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS billing_subscriptions_user ON billing_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS billing_events (
  stripe_event_id TEXT PRIMARY KEY,
  handled_at INTEGER NOT NULL
);
