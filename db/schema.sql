-- ************************ Users TABLES ************************ -- 
CREATE TABLE IF NOT EXISTS user_roles (
  role_id SERIAL PRIMARY KEY,
  role_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  role_id INT REFERENCES user_roles(role_id),
  email TEXT NOT NULL UNIQUE,  
  password TEXT NOT NULL,
  username TEXT UNIQUE, 

  phone_number TEXT, 
  avatar_url TEXT,
  date_of_birth DATE,
  gender TEXT,
  bio TEXT,
  notes TEXT,  

  active BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW()
);



-- ************************ FORUM CATEGORIES ************************ --

CREATE TABLE IF NOT EXISTS forum_categories (
  category_id SERIAL PRIMARY KEY,

  name TEXT NOT NULL UNIQUE
    CHECK (LENGTH(TRIM(name)) > 0),

  slug TEXT NOT NULL UNIQUE
    CHECK (LENGTH(TRIM(slug)) > 0),

  description TEXT,

  sort_order INT NOT NULL DEFAULT 0,

  active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);


-- ************************ FORUM POSTS ************************ --

CREATE TABLE IF NOT EXISTS posts (
  post_id SERIAL PRIMARY KEY,

  category_id INT NOT NULL
    REFERENCES forum_categories(category_id),


  author_id INT NOT NULL
    REFERENCES users(user_id),

  title TEXT NOT NULL
    CHECK (LENGTH(TRIM(title)) > 0),

  body TEXT NOT NULL
    CHECK (LENGTH(TRIM(body)) > 0),

  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  locked BOOLEAN NOT NULL DEFAULT FALSE,

  active BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMP DEFAULT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);



-- ************************ FORUM COMMENTS ************************ --

CREATE TABLE IF NOT EXISTS comments (
  comment_id SERIAL PRIMARY KEY,

  post_id INT NOT NULL
    REFERENCES posts(post_id)
    ON DELETE CASCADE,

  author_id INT NOT NULL
    REFERENCES users(user_id),

  parent_comment_id INT DEFAULT NULL,

  body TEXT NOT NULL
    CHECK (LENGTH(TRIM(body)) > 0),

  active BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMP DEFAULT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (comment_id, post_id),

  FOREIGN KEY (parent_comment_id, post_id)
    REFERENCES comments(comment_id, post_id)
);



-- ************************ FORUM CONTENT FLAGS ************************ --

CREATE TABLE IF NOT EXISTS forum_content_flags (
  flag_id SERIAL PRIMARY KEY,

  post_id INT
    REFERENCES posts(post_id)
    ON DELETE CASCADE,

  comment_id INT
    REFERENCES comments(comment_id)
    ON DELETE CASCADE,

  flagged_by INT NOT NULL
    REFERENCES users(user_id),

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



-- ************************ NOTIFICATIONS ************************ --

CREATE TABLE IF NOT EXISTS notifications (
  notification_id SERIAL PRIMARY KEY,

  user_id INT NOT NULL
    REFERENCES users(user_id),

  actor_id INT NOT NULL
    REFERENCES users(user_id),

  type TEXT NOT NULL,

  post_id INT
    REFERENCES posts(post_id)
    ON DELETE CASCADE,

  comment_id INT
    REFERENCES comments(comment_id)
    ON DELETE CASCADE,

  read_at TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created
  ON notifications(user_id, read_at, created_at DESC);



-- ************************ DIRECT MESSAGES ************************ --

-- One row per pair of members who have ever messaged each other.
-- user_one_id is always the smaller user_id of the pair, so a
-- conversation between users 5 and 9 is always stored as (5, 9) —
-- never duplicated as (9, 5). That makes "find or create the
-- conversation between A and B" a single deterministic lookup.
CREATE TABLE IF NOT EXISTS direct_conversations (
  conversation_id SERIAL PRIMARY KEY,

  user_one_id INT NOT NULL
    REFERENCES users(user_id),

  user_two_id INT NOT NULL
    REFERENCES users(user_id),

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CHECK (user_one_id < user_two_id),
  UNIQUE (user_one_id, user_two_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  message_id SERIAL PRIMARY KEY,

  conversation_id INT NOT NULL
    REFERENCES direct_conversations(conversation_id)
    ON DELETE CASCADE,

  sender_id INT NOT NULL
    REFERENCES users(user_id),

  body TEXT NOT NULL
    CHECK (LENGTH(TRIM(body)) > 0),

  read_at TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_created
  ON direct_messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_direct_messages_unread
  ON direct_messages(conversation_id, sender_id, read_at);



-- ************************ SAVED POSTS ************************ --

-- A private, silent bookmark — saving a post never notifies anyone
-- and never shows a count to other members. Just a personal list.
CREATE TABLE IF NOT EXISTS forum_saved_posts (
  user_id INT NOT NULL
    REFERENCES users(user_id),

  post_id INT NOT NULL
    REFERENCES posts(post_id)
    ON DELETE CASCADE,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, post_id)
);


