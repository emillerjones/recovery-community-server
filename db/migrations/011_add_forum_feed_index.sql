BEGIN;

CREATE INDEX IF NOT EXISTS idx_comments_post_active_created
  ON comments (post_id, created_at DESC)
  WHERE active = TRUE AND deleted_at IS NULL;

COMMIT;
