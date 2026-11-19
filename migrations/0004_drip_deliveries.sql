-- Permanent claims prevent a stale provider contact or overlapping cron from resending a step.
-- Never automatically expire a claim: a timeout may have accepted an email.
CREATE TABLE IF NOT EXISTS drip_deliveries (
  recipient_hash TEXT NOT NULL,
  step INTEGER NOT NULL CHECK (step IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'accepted', 'complete')),
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (recipient_hash, step)
);
