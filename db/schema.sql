DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS notification_types;
DROP TABLE IF EXISTS game_platforms; -- Depends on games & platforms
DROP TABLE IF EXISTS raidhelper_events; --No current dependencies
DROP TABLE IF EXISTS user_favorite_games; --Depends on users & games
DROP TABLE IF EXISTS session_users; --Depends on sessions & users
DROP TABLE IF EXISTS session_messages; --Depends on sessions & users
DROP TABLE IF EXISTS session_reviews; --Depends on sessions & users
DROP TABLE IF EXISTS sessions; -- Depends on users
DROP TABLE IF EXISTS friendships; --Depends on users
DROP TABLE IF EXISTS review_votes; -- Depends on game_reviews & users
DROP TABLE IF EXISTS game_reviews; --Depends on users and games
DROP TABLE IF EXISTS users; --Depends on roles
DROP TABLE IF EXISTS platforms; --No current dependencies

DROP TABLE IF EXISTS games; --No current dependencies
DROP TABLE IF EXISTS roles; --No current dependencies







-- ************************ Users TABLES ************************ -- 
CREATE TABLE roles (
  role_id SERIAL PRIMARY KEY,
  role_name TEXT NOT NULL
);

CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  role_id INT REFERENCES roles(role_id),
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  username TEXT UNIQUE,  
  notes TEXT,  
  steam_id TEXT UNIQUE,
  xbox_xuid      TEXT,
  xbox_gamertag  TEXT,
  battle_net_id TEXT UNIQUE,
  battle_tag TEXT,
  battle_net_region TEXT DEFAULT 'us',
  battle_net_connected_at TIMESTAMP,
  psn_id TEXT UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW(),
  avatar_url TEXT,
  date_of_birth DATE,
  gender TEXT,
  bio TEXT
);


 
CREATE TABLE friendships ( 
  user_id_1 INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  user_id_2 INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  actor_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT pk_friendships PRIMARY KEY (user_id_1, user_id_2),
  CONSTRAINT uid_order CHECK (user_id_1 < user_id_2)
);

-- ************************ Games TABLES ************************ -- 
CREATE TABLE games (
  game_id SERIAL PRIMARY KEY,
  game_title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,

  game_description TEXT,
  genre TEXT,
  category TEXT,
  age_rating TEXT,

  release_date DATE,
  developer TEXT,
  publisher TEXT,

  cover_image_url TEXT,
  banner_image_url TEXT,

  avg_rating NUMERIC,
  rating_count INTEGER DEFAULT 0,

  igdb_id INTEGER,
  steam_app_id INTEGER,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- ************************ Sessions TABLES ************************ -- 
CREATE TABLE sessions (
  session_id SERIAL PRIMARY KEY,
  game_id INT NOT NULL,
  host_user_id INT NOT NULL REFERENCES users(user_id),

  session_title TEXT NOT NULL,
  session_description TEXT,

  session_status TEXT NOT NULL DEFAULT 'active',
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  max_users INT NOT NULL DEFAULT 4,

  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  last_activity_at TIMESTAMP DEFAULT NOW(),

  matchmaking_enabled BOOLEAN DEFAULT TRUE, 
  playstyle TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id INT NULL REFERENCES users(user_id),
  creation_source TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE session_users (
  session_user_id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,

  membership_status TEXT NOT NULL DEFAULT 'invited',
  is_host BOOLEAN NOT NULL DEFAULT FALSE,

  invited_at TIMESTAMP,
  joined_at TIMESTAMP,
  left_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (session_id, user_id)
);

CREATE TABLE session_messages (
  session_message_id SERIAL PRIMARY KEY,

  session_id INTEGER NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,

  message_text TEXT NOT NULL,

  -- soft delete
  is_deleted BOOLEAN DEFAULT false,
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES users(user_id),

  -- moderation / flagging
  is_flagged BOOLEAN DEFAULT false,
  flagged_at TIMESTAMP,
  flagged_by INTEGER REFERENCES users(user_id),
  flag_reason TEXT,

  -- logging
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);




--Moved to create after games table is created.
CREATE TABLE user_favorite_games (
    user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    game_id INT REFERENCES games(game_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, game_id)
);
CREATE TABLE platforms (
  platform_id SERIAL PRIMARY KEY,
  platform_name TEXT NOT NULL UNIQUE, -- steam, xbox, psn

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE game_platforms (
  game_platform_id SERIAL PRIMARY KEY,
  game_id INT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  platform_id INT NOT NULL REFERENCES platforms(platform_id) ON DELETE CASCADE,

  external_game_id TEXT, -- id from steam/psn/xbox api if needed

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (game_id, platform_id)
);




-- ************************ Reviews TABLES ************************ -- 
CREATE TABLE game_reviews (
  game_review_id SERIAL PRIMARY KEY,
  review_title TEXT,
  game_review TEXT,
  game_id INT NOT NULL REFERENCES games(game_id), 

  --- User, rating and timestamp
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  rating_value INT NOT NULL CHECK (rating_value IN (1, 2, 3, 4, 5)),
  view_counter INT NOT NULL DEFAULT 0,

  -- moderation / flagging
  is_flagged BOOLEAN DEFAULT false,
  flagged_at TIMESTAMP,
  flagged_by INTEGER REFERENCES users(user_id),
  flag_reason TEXT
);


-- Table to store thumbs up / thumbs down votes for game reviews
CREATE TABLE review_votes (
  review_vote_id SERIAL PRIMARY KEY,
  game_review_id INT NOT NULL REFERENCES game_reviews(game_review_id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  vote_value INT NOT NULL CHECK (vote_value IN (1, -1)), -- 1 = thumbs up, -1 = thumbs down
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (game_review_id, user_id)
);

CREATE TABLE session_reviews (
  session_review_id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_rating INT NOT NULL CHECK (session_rating IN (1, 2, 3, 4, 5)),
  member_ratings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);


-- ************************ Notifications TABLES ************************ -- 
CREATE TABLE notification_types (
  notification_type_id SERIAL PRIMARY KEY,

  type_key TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,

  category TEXT,
  icon TEXT,

  active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notifications (
  notification_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,

  notification_type TEXT,
  notification_type_id INTEGER REFERENCES notification_types(notification_type_id),
  notification_text TEXT NOT NULL,

  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  read_at TIMESTAMP
);

CREATE TABLE raidhelper_events (
  raidhelper_event_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,

  event_id TEXT,
  softres_id TEXT,
  guild_id TEXT,
  guild_name TEXT,
  channel_id TEXT,

  raid_name TEXT,
  raid_notes TEXT,
  raid_leader TEXT,


  title TEXT,
  start_time TIMESTAMP,
  signup_count INTEGER,
  signup_max INTEGER,

  raidhelper_url TEXT,
  softres_url TEXT,
  raw_json JSONB,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE (user_id, event_id),
  UNIQUE (user_id, softres_id)
);