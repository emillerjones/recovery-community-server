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


