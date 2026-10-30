BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE moderation_settings ADD COLUMN IF NOT EXISTS thresholds JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(thresholds)='object');
ALTER TABLE moderation_settings ADD COLUMN IF NOT EXISTS threshold_revision INTEGER NOT NULL DEFAULT 1 CHECK(threshold_revision>0);
ALTER TABLE moderation_settings ADD COLUMN IF NOT EXISTS thresholds_updated_at TIMESTAMPTZ;
ALTER TABLE moderation_settings ADD COLUMN IF NOT EXISTS thresholds_updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS moderation_threshold_changes (
  change_id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  previous_threshold DOUBLE PRECISION NOT NULL CHECK(previous_threshold BETWEEN 0 AND 1),
  threshold DOUBLE PRECISION NOT NULL CHECK(threshold BETWEEN 0 AND 1),
  revision INTEGER NOT NULL UNIQUE,
  changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(previous_threshold<>threshold)
);
COMMIT;
