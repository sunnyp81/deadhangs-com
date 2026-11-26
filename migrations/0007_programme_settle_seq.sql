-- Compare-and-set counter for programme settlement: a slow settlement can never overwrite a newer one.
ALTER TABLE programme_purchases ADD COLUMN settle_seq INTEGER NOT NULL DEFAULT 0;
