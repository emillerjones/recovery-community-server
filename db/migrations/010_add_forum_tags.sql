BEGIN;

CREATE TABLE IF NOT EXISTS forum_tags (
  tag_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) > 0),
  slug TEXT NOT NULL UNIQUE CHECK (LENGTH(TRIM(slug)) > 0),
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forum_post_tags (
  post_id INT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  tag_id INT NOT NULL REFERENCES forum_tags(tag_id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_post_tags_tag_post
  ON forum_post_tags (tag_id, post_id);

INSERT INTO forum_categories (name, slug, description, sort_order)
VALUES ('Announcements', 'announcements', 'Official updates from community staff.', 0)
ON CONFLICT (slug) DO UPDATE SET active = TRUE;

INSERT INTO forum_tags (name, slug, description, sort_order)
VALUES
  ('My Story', 'mystory', 'Personal experiences and recovery stories.', 1),
  ('Question', 'question', 'Questions for the community.', 2),
  ('Live Meetings', 'livemeetings', 'Live meetings, schedules, and discussion.', 3),
  ('12 Steps', '12steps', 'Twelve-step experiences and discussion.', 4)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
