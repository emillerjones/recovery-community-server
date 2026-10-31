BEGIN;

ALTER TABLE moderation_settings
  ADD COLUMN IF NOT EXISTS review_mode TEXT NOT NULL DEFAULT 'cutoffs' CHECK (review_mode IN ('cutoffs','openai','either')),
  ADD COLUMN IF NOT EXISTS review_mode_revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS review_mode_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_mode_updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS moderation_mode_changes (
  change_id BIGSERIAL PRIMARY KEY,
  previous_mode TEXT NOT NULL CHECK (previous_mode IN ('cutoffs','openai','either')),
  review_mode TEXT NOT NULL CHECK (review_mode IN ('cutoffs','openai','either')),
  revision INTEGER NOT NULL UNIQUE,
  changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (previous_mode <> review_mode)
);

-- Existing report cards keep their original cutoff-based decision.
ALTER TABLE moderation_results
  ADD COLUMN IF NOT EXISTS review_mode TEXT NOT NULL DEFAULT 'cutoffs' CHECK (review_mode IN ('cutoffs','openai','either')),
  ADD COLUMN IF NOT EXISTS review_reasons JSONB CHECK (review_reasons IS NULL OR jsonb_typeof(review_reasons)='array');

COMMIT;
