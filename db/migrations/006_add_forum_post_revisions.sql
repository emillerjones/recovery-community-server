BEGIN;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_edited_at TIMESTAMP DEFAULT NULL;

-- Private audit storage only: no public endpoint exposes previous wording.
CREATE TABLE IF NOT EXISTS forum_post_revisions (
  revision_id SERIAL PRIMARY KEY,
  post_id INT NOT NULL
    REFERENCES posts(post_id)
    ON DELETE CASCADE,
  edited_by INT
    REFERENCES users(user_id)
    ON DELETE SET NULL,
  previous_title TEXT NOT NULL,
  previous_body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_post_revisions_post_created
  ON forum_post_revisions (post_id, created_at DESC);

COMMIT;
