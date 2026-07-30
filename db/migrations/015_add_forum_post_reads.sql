-- Track one member's latest visit to one forum conversation.
CREATE TABLE IF NOT EXISTS forum_post_reads (
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  post_id INT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  last_read_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_read_comment_id INT REFERENCES comments(comment_id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_post_reads_user_time
  ON forum_post_reads (user_id, last_read_at DESC);
