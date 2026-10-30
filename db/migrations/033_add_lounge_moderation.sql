BEGIN;
SET LOCAL lock_timeout = '5s';

-- Existing messages remain revision zero: there is deliberately no backfill.
ALTER TABLE lounge_messages ADD COLUMN IF NOT EXISTS moderation_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lounge_messages ADD COLUMN IF NOT EXISTS moderation_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS moderation_jobs (
  job_id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES lounge_messages(message_id) ON DELETE CASCADE,
  content_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','superseded')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claim_token UUID,
  claimed_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(message_id, content_version)
);
CREATE INDEX IF NOT EXISTS moderation_jobs_ready ON moderation_jobs(next_attempt_at) WHERE status IN ('pending','processing');

CREATE TABLE IF NOT EXISTS moderation_results (
  result_id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL UNIQUE REFERENCES moderation_jobs(job_id) ON DELETE CASCADE,
  message_id BIGINT NOT NULL REFERENCES lounge_messages(message_id) ON DELETE CASCADE,
  content_version INTEGER NOT NULL,
  content_snapshot TEXT,
  model TEXT NOT NULL,
  response JSONB,
  thresholds_used JSONB,
  triggered_categories JSONB NOT NULL DEFAULT '[]',
  needs_review BOOLEAN NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('not_needed','pending','cleared','deleted','superseded','expired')),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  purged_at TIMESTAMPTZ,
  UNIQUE(message_id, content_version)
);
CREATE INDEX IF NOT EXISTS moderation_results_queue ON moderation_results(review_status, checked_at DESC);

CREATE TABLE IF NOT EXISTS moderation_review_actions (
  action_id BIGSERIAL PRIMARY KEY,
  result_id BIGINT NOT NULL REFERENCES moderation_results(result_id) ON DELETE CASCADE,
  reviewer_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('clear','delete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION lounge_moderation_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.body IS NOT DISTINCT FROM OLD.body THEN RETURN NEW; END IF;
  IF NEW.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM lounge_rooms WHERE room_id=NEW.room_id AND slug='community-lounge' AND access_level='members'
  ) THEN
    NEW.moderation_revision := CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.moderation_revision+1 END;
    NEW.moderation_changed_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lounge_moderation_revision ON lounge_messages;
CREATE TRIGGER lounge_moderation_revision BEFORE INSERT OR UPDATE OF body ON lounge_messages
  FOR EACH ROW EXECUTE FUNCTION lounge_moderation_revision();

CREATE OR REPLACE FUNCTION enqueue_lounge_moderation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.moderation_revision>0 AND NEW.deleted_at IS NULL AND
    EXISTS (SELECT 1 FROM lounge_rooms WHERE room_id=NEW.room_id AND slug='community-lounge' AND access_level='members') THEN
    INSERT INTO moderation_jobs(message_id,content_version) VALUES(NEW.message_id,NEW.moderation_revision)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Fail open: the reconciliation scan repairs missed jobs. Never log message text.
  RAISE WARNING 'Lounge moderation enqueue failed (SQLSTATE %)', SQLSTATE;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enqueue_lounge_moderation ON lounge_messages;
CREATE TRIGGER enqueue_lounge_moderation AFTER INSERT OR UPDATE OF body ON lounge_messages
  FOR EACH ROW EXECUTE FUNCTION enqueue_lounge_moderation();
COMMIT;
