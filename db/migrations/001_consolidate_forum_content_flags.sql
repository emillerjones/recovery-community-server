BEGIN;

CREATE TABLE IF NOT EXISTS forum_content_flags (
  flag_id SERIAL PRIMARY KEY,
  post_id INT REFERENCES posts(post_id) ON DELETE CASCADE,
  comment_id INT REFERENCES comments(comment_id) ON DELETE CASCADE,
  flagged_by INT NOT NULL REFERENCES users(user_id),
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMP DEFAULT NULL,
  reviewed_by INT REFERENCES users(user_id),
  CHECK (num_nonnulls(post_id, comment_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_open_post_flag_per_user
  ON forum_content_flags(post_id, flagged_by)
  WHERE post_id IS NOT NULL AND reviewed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_open_comment_flag_per_user
  ON forum_content_flags(comment_id, flagged_by)
  WHERE comment_id IS NOT NULL AND reviewed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_forum_content_flags_review_queue
  ON forum_content_flags(reviewed_at, created_at DESC);

INSERT INTO forum_content_flags
  (post_id, flagged_by, reason, created_at, reviewed_at, reviewed_by)
SELECT post_id, reporter_id, reason, created_at, resolved_at, resolved_by
FROM forum_post_reports
ON CONFLICT DO NOTHING;

INSERT INTO forum_content_flags
  (comment_id, flagged_by, reason, created_at, reviewed_at, reviewed_by)
SELECT comment_id, reporter_id, reason, created_at, resolved_at, resolved_by
FROM forum_comment_reports
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM forum_post_reports old
    WHERE NOT EXISTS (
      SELECT 1 FROM forum_content_flags current
      WHERE current.post_id = old.post_id
        AND current.flagged_by = old.reporter_id
        AND current.created_at = old.created_at
    )
  ) OR EXISTS (
    SELECT 1
    FROM forum_comment_reports old
    WHERE NOT EXISTS (
      SELECT 1 FROM forum_content_flags current
      WHERE current.comment_id = old.comment_id
        AND current.flagged_by = old.reporter_id
        AND current.created_at = old.created_at
    )
  ) THEN
    RAISE EXCEPTION 'Legacy forum flags were not fully migrated';
  END IF;
END $$;

DROP TABLE forum_post_reports;
DROP TABLE forum_comment_reports;

COMMIT;
