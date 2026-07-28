BEGIN;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_edited_by INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_content_edited_by_fkey'
      AND conrelid = 'posts'::regclass
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_content_edited_by_fkey
      FOREIGN KEY (content_edited_by) REFERENCES users(user_id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS content_edited_at TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS content_edited_by INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'comments_content_edited_by_fkey'
      AND conrelid = 'comments'::regclass
  ) THEN
    ALTER TABLE comments
      ADD CONSTRAINT comments_content_edited_by_fkey
      FOREIGN KEY (content_edited_by) REFERENCES users(user_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS forum_comment_revisions (
  revision_id SERIAL PRIMARY KEY,
  comment_id INT NOT NULL
    REFERENCES comments(comment_id)
    ON DELETE CASCADE,
  edited_by INT
    REFERENCES users(user_id)
    ON DELETE SET NULL,
  previous_body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_comment_revisions_comment_created
  ON forum_comment_revisions (comment_id, created_at DESC);

COMMIT;
