BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS moderation_settings (
  settings_id INTEGER PRIMARY KEY CHECK (settings_id=1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL
);
INSERT INTO moderation_settings(settings_id) VALUES(1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS moderation_setting_changes (
  change_id BIGSERIAL PRIMARY KEY,
  previous_enabled BOOLEAN NOT NULL,
  enabled BOOLEAN NOT NULL,
  revision INTEGER NOT NULL UNIQUE,
  changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (previous_enabled<>enabled)
);
COMMIT;
