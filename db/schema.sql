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

  -- System accounts author automatic community content but are not people:
  -- they cannot log in and stay out of member searches and administration.
  is_system BOOLEAN NOT NULL DEFAULT FALSE,

  -- Existing members are approved by default. The public registration query
  -- explicitly creates new accounts as unverified until they use their email link.
  account_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (account_status IN ('unverified', 'pending', 'approved', 'rejected')),
  email_verified_at TIMESTAMP,

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

-- Rerunning schema.sql upgrades an existing users table too; CREATE TABLE IF
-- NOT EXISTS only supplies is_system when the table is brand new.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_system_account
  ON users (is_system)
  WHERE is_system = TRUE;



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
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  content_edited_at TIMESTAMP DEFAULT NULL,
  content_edited_by INT
    REFERENCES users(user_id)
    ON DELETE SET NULL,

  -- Set only on the one automatic welcome post created for this member.
  -- The unique value makes approval retries unable to create duplicates.
  welcome_member_id INT
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

-- Existing development databases also receive the new column when schema.sql
-- is rerun; CREATE TABLE IF NOT EXISTS alone cannot add later columns.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_edited_at TIMESTAMP DEFAULT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_edited_by INT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS welcome_member_id INT;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_welcome_member_id_fkey'
      AND conrelid = 'posts'::regclass
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_welcome_member_id_fkey
      FOREIGN KEY (welcome_member_id) REFERENCES users(user_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_welcome_member_id_unique'
      AND conrelid = 'posts'::regclass
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_welcome_member_id_unique UNIQUE (welcome_member_id);
  END IF;
END $$;


-- ********************* PRIVATE POST REVISION HISTORY ********************* --
-- This is intentionally database-only. Members see that a post was edited,
-- but old wording is not exposed through a front-facing API or page.
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
  content_edited_at TIMESTAMP DEFAULT NULL,
  content_edited_by INT
    REFERENCES users(user_id)
    ON DELETE SET NULL,

  UNIQUE (comment_id, post_id),

  FOREIGN KEY (parent_comment_id, post_id)
    REFERENCES comments(comment_id, post_id)
);

ALTER TABLE comments ADD COLUMN IF NOT EXISTS content_edited_at TIMESTAMP DEFAULT NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS content_edited_by INT;

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

-- Like post revisions, comment revisions are private audit records. Members
-- see only an edited label; no front-facing endpoint exposes previous wording.
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


-- ************************ FORUM REACTIONS ************************ --

-- One supportive reaction per member on a post or reply. A member can
-- change that reaction, or remove it by clicking the active reaction again.
CREATE TABLE IF NOT EXISTS forum_reactions (
  reaction_id SERIAL PRIMARY KEY,

  user_id INT NOT NULL
    REFERENCES users(user_id),

  post_id INT
    REFERENCES posts(post_id)
    ON DELETE CASCADE,

  comment_id INT
    REFERENCES comments(comment_id)
    ON DELETE CASCADE,

  reaction_type TEXT NOT NULL
    CHECK (reaction_type IN (
      'support', 'agree', 'relate', 'encouragement',
      'helpful', 'celebrate', 'inspiring', 'care'
    )),

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


-- ************************ FORUM MENTIONS ************************ --

-- Records the real member behind each visible @username in a post or reply.
-- username_snapshot preserves the text that appeared when the mention was made,
-- even if that member changes their username later.
CREATE TABLE IF NOT EXISTS forum_mentions (
  mention_id SERIAL PRIMARY KEY,

  mentioned_user_id INT NOT NULL
    REFERENCES users(user_id),

  mentioned_by INT NOT NULL
    REFERENCES users(user_id),

  post_id INT
    REFERENCES posts(post_id)
    ON DELETE CASCADE,

  comment_id INT
    REFERENCES comments(comment_id)
    ON DELETE CASCADE,

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


-- ************************ MEMBERSHIP REGISTRATION ************************ --

-- One application accompanies every public registration. Keeping these answers
-- outside users makes the member record small and leaves a clear review history.
CREATE TABLE IF NOT EXISTS membership_applications (
  application_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  reason_for_joining TEXT NOT NULL,
  how_did_you_find_us TEXT NOT NULL,
  admission_method TEXT NOT NULL
    CHECK (admission_method IN ('standard', 'personal_invite', 'shared_code')),
  personal_invite_id INT,
  shared_code_id INT,
  agreed_to_rules_at TIMESTAMP NOT NULL,
  agreed_to_privacy_at TIMESTAMP NOT NULL,
  reviewed_by INT REFERENCES users(user_id),
  reviewed_at TIMESTAMP,
  rejection_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS personal_invites (
  invite_id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INT NOT NULL REFERENCES users(user_id),
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  used_by INT REFERENCES users(user_id),
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shared_invite_codes (
  code_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  created_by INT NOT NULL REFERENCES users(user_id),
  expires_at TIMESTAMP NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  max_uses INT CHECK (max_uses IS NULL OR max_uses > 0),
  use_count INT NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  verification_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE membership_applications
  DROP CONSTRAINT IF EXISTS membership_applications_personal_invite_id_fkey,
  ADD CONSTRAINT membership_applications_personal_invite_id_fkey
    FOREIGN KEY (personal_invite_id) REFERENCES personal_invites(invite_id),
  DROP CONSTRAINT IF EXISTS membership_applications_shared_code_id_fkey,
  ADD CONSTRAINT membership_applications_shared_code_id_fkey
    FOREIGN KEY (shared_code_id) REFERENCES shared_invite_codes(code_id),
  DROP CONSTRAINT IF EXISTS membership_applications_admission_source_check,
  ADD CONSTRAINT membership_applications_admission_source_check CHECK (
    (admission_method = 'standard' AND personal_invite_id IS NULL AND shared_code_id IS NULL)
    OR (admission_method = 'personal_invite' AND personal_invite_id IS NOT NULL AND shared_code_id IS NULL)
    OR (admission_method = 'shared_code' AND shared_code_id IS NOT NULL AND personal_invite_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_membership_applications_review_queue
  ON membership_applications(reviewed_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_verification_user_active
  ON email_verification_tokens(user_id, used_at, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_invites_created
  ON personal_invites(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_invite_codes_active
  ON shared_invite_codes(active, expires_at);


-- ********************* AUTOMATED COMMUNITY POSTS ********************* --
-- Every newly created forum post alerts every approved, active human member.
-- This includes the author because the owner explicitly wants ALL members.
CREATE OR REPLACE FUNCTION notify_members_of_new_forum_post()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO notifications (user_id, actor_id, type, post_id)
  SELECT user_id, NEW.author_id, 'new_forum_post', NEW.post_id
  FROM users
  WHERE account_status = 'approved'
    AND active = TRUE
    AND deleted_at IS NULL
    AND is_system = FALSE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_members_of_new_forum_post ON posts;
CREATE TRIGGER trg_notify_members_of_new_forum_post
AFTER INSERT ON posts
FOR EACH ROW
EXECUTE FUNCTION notify_members_of_new_forum_post();

-- Approval through any path reaches the users table. Putting the welcome-post
-- hook here keeps standard approval, personal invites, and shared codes in one
-- guaranteed path and in the same transaction as the approval itself.
CREATE OR REPLACE FUNCTION create_approved_member_welcome_post()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  system_user_id INT;
  introductions_category_id INT;
  welcome_post_id INT;
BEGIN
  IF NEW.is_system = TRUE
    OR NEW.role_id <> 100
    OR NEW.account_status <> 'approved'
    OR (TG_OP = 'UPDATE' AND OLD.account_status = 'approved') THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO system_user_id
  FROM users
  WHERE is_system = TRUE
    AND active = TRUE
    AND deleted_at IS NULL
  LIMIT 1;

  SELECT category_id INTO introductions_category_id
  FROM forum_categories
  WHERE slug = 'introductions' AND active = TRUE
  LIMIT 1;

  IF system_user_id IS NULL OR introductions_category_id IS NULL THEN
    RAISE EXCEPTION 'Cannot create member welcome post without the protected system user and Introductions category';
  END IF;

  INSERT INTO posts (
    category_id, author_id, title, body, welcome_member_id
  )
  VALUES (
    introductions_category_id,
    system_user_id,
    format('Welcome, %s!', NEW.username),
    format('Please join us in giving a warm welcome to our newest community member, @%s. We''re glad you''re here!', NEW.username),
    NEW.user_id
  )
  ON CONFLICT (welcome_member_id) DO NOTHING
  RETURNING post_id INTO welcome_post_id;

  IF welcome_post_id IS NOT NULL THEN
    INSERT INTO forum_mentions (
      mentioned_user_id, mentioned_by, post_id, username_snapshot
    )
    VALUES (NEW.user_id, system_user_id, welcome_post_id, NEW.username)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_approved_member_welcome_post ON users;
CREATE TRIGGER trg_create_approved_member_welcome_post
AFTER INSERT OR UPDATE OF account_status ON users
FOR EACH ROW
EXECUTE FUNCTION create_approved_member_welcome_post();


