CREATE TABLE IF NOT EXISTS forum_polls (
  poll_id BIGSERIAL PRIMARY KEY,
  post_id INT NOT NULL UNIQUE REFERENCES posts(post_id) ON DELETE CASCADE,
  question TEXT NOT NULL CHECK (LENGTH(TRIM(question)) BETWEEN 1 AND 300),
  allow_multiple BOOLEAN NOT NULL DEFAULT FALSE,
  results_visibility TEXT NOT NULL DEFAULT 'after_vote'
    CHECK (results_visibility IN ('always', 'after_vote', 'after_close')),
  voter_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (voter_visibility IN ('private', 'named')),
  closes_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  voting_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forum_poll_options (
  option_id BIGSERIAL PRIMARY KEY,
  poll_id BIGINT NOT NULL REFERENCES forum_polls(poll_id) ON DELETE CASCADE,
  option_text TEXT NOT NULL CHECK (LENGTH(TRIM(option_text)) BETWEEN 1 AND 200),
  display_order SMALLINT NOT NULL CHECK (display_order BETWEEN 0 AND 9),
  UNIQUE (poll_id, display_order)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_poll_options_unique_text
  ON forum_poll_options (poll_id, LOWER(TRIM(option_text)));

CREATE TABLE IF NOT EXISTS forum_poll_votes (
  option_id BIGINT NOT NULL REFERENCES forum_poll_options(option_id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (option_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_poll_votes_user
  ON forum_poll_votes (user_id, option_id);
