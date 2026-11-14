-- One-off 8-week plan purchases. Account-less: access is a signed link whose token hash is stored here.
CREATE TABLE IF NOT EXISTS plan_purchases (
  checkout_session_id TEXT PRIMARY KEY,
  payment_intent_id TEXT,
  email TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  inputs TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('paid', 'refunded')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  refunded_at INTEGER
);
CREATE INDEX IF NOT EXISTS plan_purchases_intent ON plan_purchases(payment_intent_id);
