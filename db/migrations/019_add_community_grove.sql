BEGIN;

CREATE TABLE IF NOT EXISTS community_checkins (
  checkin_id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL DEFAULT CURRENT_DATE,
  mood TEXT NOT NULL CHECK (mood IN ('steady', 'hopeful', 'one_day', 'difficult', 'support', 'celebrating')),
  note VARCHAR(180),
  open_to_support BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_community_checkins_day
  ON community_checkins(checkin_date, updated_at DESC);

CREATE TABLE IF NOT EXISTS community_checkin_supports (
  checkin_id BIGINT NOT NULL REFERENCES community_checkins(checkin_id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (checkin_id, user_id)
);

COMMIT;
