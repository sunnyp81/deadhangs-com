-- Private, manually operated gym challenge pilot. Every read and write is scoped by campaign membership on the server.
CREATE TABLE IF NOT EXISTS gym_enquiries (
  id TEXT PRIMARY KEY,
  gym_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  location TEXT,
  members TEXT,
  message TEXT,
  consent_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'booked', 'closed')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gym_campaigns (
  id TEXT PRIMARY KEY,
  gym_name TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  brand_json TEXT NOT NULL DEFAULT '{}',
  board_visibility TEXT NOT NULL DEFAULT 'organiser' CHECK (board_visibility IN ('organiser', 'members')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS gym_members (
  campaign_id TEXT NOT NULL REFERENCES gym_campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('organiser', 'participant')),
  display_name TEXT NOT NULL,
  show_on_board INTEGER NOT NULL DEFAULT 0 CHECK (show_on_board IN (0, 1)),
  joined_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (campaign_id, user_id)
);
CREATE TABLE IF NOT EXISTS gym_invites (
  token_hash TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES gym_campaigns(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('organiser', 'participant')),
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  max_uses INTEGER NOT NULL CHECK (max_uses >= 1),
  uses INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gym_results (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES gym_campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  seconds INTEGER NOT NULL CHECK (seconds BETWEEN 1 AND 3600),
  local_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  corrected_seconds INTEGER CHECK (corrected_seconds IS NULL OR corrected_seconds BETWEEN 1 AND 3600),
  correction_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gym_results_campaign ON gym_results(campaign_id, status);
CREATE INDEX IF NOT EXISTS gym_members_user ON gym_members(user_id);
