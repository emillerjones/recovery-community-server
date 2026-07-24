-- Adds member mentions without changing or removing existing forum data.
CREATE TABLE IF NOT EXISTS forum_mentions (
  mention_id SERIAL PRIMARY KEY,
  mentioned_user_id INT NOT NULL REFERENCES users(user_id),
  mentioned_by INT NOT NULL REFERENCES users(user_id),
  post_id INT REFERENCES posts(post_id) ON DELETE CASCADE,
  comment_id INT REFERENCES comments(comment_id) ON DELETE CASCADE,
  username_snapshot TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(post_id, comment_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_mentions_one_per_post
  ON forum_mentions(post_id, mentioned_user_id)
  WHERE post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_mentions_one_per_comment
  ON forum_mentions(comment_id, mentioned_user_id)
  WHERE comment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_forum_mentions_recipient
  ON forum_mentions(mentioned_user_id, created_at DESC);
