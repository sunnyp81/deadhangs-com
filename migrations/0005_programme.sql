-- Paid programme purchases, kept apart from Pro subscriptions. No foreign key to "user": on account deletion the
-- row is detached (user_id set to NULL) so the payment record survives while personal training data is removed.
CREATE TABLE IF NOT EXISTS programme_purchases (
  checkout_session_id TEXT PRIMARY KEY,
  user_id TEXT,
  programme_id TEXT NOT NULL,
  programme_version TEXT NOT NULL,
  provider_mode TEXT NOT NULL CHECK (provider_mode IN ('live', 'test')),
  stripe_customer_id TEXT NOT NULL,
  payment_intent_id TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'expired', 'paid', 'refunded', 'disputed')),
  source TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  status_changed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS programme_purchases_user ON programme_purchases(user_id, programme_id);
CREATE INDEX IF NOT EXISTS programme_purchases_intent ON programme_purchases(payment_intent_id);
-- Programme progress: one revisioned JSON state per user and programme. Removed with the user.
CREATE TABLE IF NOT EXISTS programme_progress (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  programme_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  state_json TEXT NOT NULL CHECK (length(state_json) <= 262144),
  reminder_enabled INTEGER NOT NULL DEFAULT 0 CHECK (reminder_enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, programme_id)
);
-- "Email me once when it opens". Separate from the newsletter list; never enrolled in any drip.
CREATE TABLE IF NOT EXISTS programme_interest (
  email TEXT NOT NULL,
  programme_id TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  source TEXT,
  created_at INTEGER NOT NULL,
  notified_at INTEGER,
  PRIMARY KEY (email, programme_id)
);
-- One reminder per person per local day. A claim is never expired automatically: a timeout may have delivered the email.
CREATE TABLE IF NOT EXISTS programme_reminder_deliveries (
  user_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'sent', 'skipped', 'failed')),
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, local_date)
);
