-- Adds supportive reactions without changing or removing existing forum data.
CREATE TABLE IF NOT EXISTS forum_reactions (
  reaction_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id),
  post_id INT REFERENCES posts(post_id) ON DELETE CASCADE,
  comment_id INT REFERENCES comments(comment_id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL
    CHECK (reaction_type IN ('support', 'relate', 'encouragement', 'helpful')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(post_id, comment_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_reactions_one_per_post
  ON forum_reactions(post_id, user_id)
  WHERE post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_reactions_one_per_comment
  ON forum_reactions(comment_id, user_id)
  WHERE comment_id IS NOT NULL;
