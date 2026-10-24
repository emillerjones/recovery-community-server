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
  auth_version INT NOT NULL DEFAULT 0,
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
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auth_version INT NOT NULL DEFAULT 0;

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

  is_imported BOOLEAN NOT NULL DEFAULT FALSE,
  imported_author_label TEXT DEFAULT NULL,
  CONSTRAINT posts_imported_author_check CHECK (
    (is_imported = FALSE AND imported_author_label IS NULL)
    OR (is_imported = TRUE AND imported_author_label IS NOT NULL
      AND imported_author_label = btrim(imported_author_label)
      AND char_length(imported_author_label) BETWEEN 1 AND 80
      AND imported_author_label !~ '[[:cntrl:]]')
  ),

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

-- Tags describe a conversation without splitting the community into separate
-- spaces. Staff curate this list; members choose from active options.
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

CREATE TABLE IF NOT EXISTS forum_post_tags (
  post_id INT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  tag_id INT NOT NULL REFERENCES forum_tags(tag_id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_post_tags_tag_post
  ON forum_post_tags (tag_id, post_id);


-- ************************ FORUM POLLS ************************ --

-- Polls belong only to original forum posts. Whether a single-choice poll may
-- accept several selected options is deliberately enforced by the API's vote
-- transaction, because allow_multiple belongs to the parent poll row.
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


-- ********************* POST REVISION HISTORY ********************* --
-- Previous wording is available to approved readers of the original post.
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

-- The forum feed repeatedly counts comments and finds the newest activity for
-- one post. This partial index keeps that work focused on visible replies.
CREATE INDEX IF NOT EXISTS idx_comments_post_active_created
  ON comments (post_id, created_at DESC)
  WHERE active = TRUE AND deleted_at IS NULL;

ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS imported_author_label TEXT DEFAULT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'comments'::regclass AND conname = 'comments_imported_author_check') THEN
    ALTER TABLE comments ADD CONSTRAINT comments_imported_author_check CHECK (
      (is_imported = FALSE AND imported_author_label IS NULL)
      OR (is_imported = TRUE AND imported_author_label IS NOT NULL
        AND imported_author_label = btrim(imported_author_label)
        AND char_length(imported_author_label) BETWEEN 1 AND 80
        AND imported_author_label !~ '[[:cntrl:]]')
    );
  END IF;
END $$;

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

-- ************************ PROTECTED FORUM PHOTOS ************************ --

-- The file bytes live in Cloudinary as authenticated assets. PostgreSQL keeps
-- ownership, dimensions, lifecycle state, and the content relationship.
CREATE TABLE IF NOT EXISTS media_assets (
  media_id BIGSERIAL PRIMARY KEY,
  uploaded_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'cloudinary' CHECK (provider = 'cloudinary'),
  provider_asset_id TEXT NOT NULL UNIQUE,
  delivery_type TEXT NOT NULL DEFAULT 'authenticated' CHECK (delivery_type = 'authenticated'),
  format TEXT NOT NULL,
  byte_size INT NOT NULL CHECK (byte_size > 0),
  width INT NOT NULL CHECK (width > 0),
  height INT NOT NULL CHECK (height > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'attached', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attached_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_media_assets_pending_cleanup
  ON media_assets(created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS forum_post_images (
  post_id INT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  media_id BIGINT NOT NULL UNIQUE REFERENCES media_assets(media_id) ON DELETE CASCADE,
  display_order SMALLINT NOT NULL CHECK (display_order BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, media_id),
  UNIQUE (post_id, display_order)
);

CREATE TABLE IF NOT EXISTS forum_comment_images (
  comment_id INT NOT NULL REFERENCES comments(comment_id) ON DELETE CASCADE,
  media_id BIGINT NOT NULL UNIQUE REFERENCES media_assets(media_id) ON DELETE CASCADE,
  display_order SMALLINT NOT NULL CHECK (display_order BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, media_id),
  UNIQUE (comment_id, display_order)
);

-- A profile photo uses the same protected media storage as forum photos. The
-- text value remains populated as media:<id> so existing user queries continue
-- carrying the avatar reference without exposing a Cloudinary URL.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_media_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_avatar_media_id_fkey'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_avatar_media_id_fkey
      FOREIGN KEY (avatar_media_id) REFERENCES media_assets(media_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_avatar_media_id
  ON users(avatar_media_id)
  WHERE avatar_media_id IS NOT NULL;


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

  -- Photo-only messages use an empty string. The API requires text, one or
  -- more attached photos, or both in the message transaction.
  body TEXT NOT NULL DEFAULT '',

  read_at TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_created
  ON direct_messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_direct_messages_unread
  ON direct_messages(conversation_id, sender_id, read_at);

-- Rerunning schema.sql upgrades databases created before photo-only messages.
ALTER TABLE direct_messages
  DROP CONSTRAINT IF EXISTS direct_messages_body_check;

ALTER TABLE direct_messages
  ALTER COLUMN body SET DEFAULT '';

CREATE TABLE IF NOT EXISTS direct_message_images (
  message_id INT NOT NULL REFERENCES direct_messages(message_id) ON DELETE CASCADE,
  media_id BIGINT NOT NULL UNIQUE REFERENCES media_assets(media_id) ON DELETE CASCADE,
  display_order SMALLINT NOT NULL CHECK (display_order BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, media_id),
  UNIQUE (message_id, display_order)
);



-- ************************ FOLLOWED POSTS ************************ --

-- A private following relationship. Following adds the conversation to the
-- member's list and opts them into new-comment/reply notifications. Exact
-- follower counts are visible only to the post author.
CREATE TABLE IF NOT EXISTS forum_saved_posts (
  user_id INT NOT NULL
    REFERENCES users(user_id),

  post_id INT NOT NULL
    REFERENCES posts(post_id)
    ON DELETE CASCADE,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, post_id)
);

-- One row means this member has actually opened this conversation. Keeping
-- the newest visible comment they saw lets the forum find their first new
-- reply without storing one read row for every individual comment.
CREATE TABLE IF NOT EXISTS forum_post_reads (
  user_id INT NOT NULL
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  post_id INT NOT NULL
    REFERENCES posts(post_id)
    ON DELETE CASCADE,
  last_read_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_read_comment_id INT
    REFERENCES comments(comment_id)
    ON DELETE SET NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_post_reads_user_time
  ON forum_post_reads (user_id, last_read_at DESC);


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
      'support', 'like', 'relate',
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

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  reset_id SERIAL PRIMARY KEY,
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
CREATE INDEX IF NOT EXISTS idx_password_reset_user_active
  ON password_reset_tokens(user_id, used_at, expires_at DESC);
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

-- ************************ BASIC FIRST-PARTY ANALYTICS ************************ --
-- Store only coarse usage facts. Raw IP addresses and private content are not
-- persisted. Deleting a user keeps aggregate history but removes its identity.
CREATE TABLE IF NOT EXISTS analytics_events (
  event_id BIGSERIAL PRIMARY KEY,
  user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
  session_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('login', 'logout', 'page_view')),
  page_key TEXT,
  device_type TEXT NOT NULL CHECK (device_type IN ('mobile', 'tablet', 'desktop')),
  country_code VARCHAR(2),
  region VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (event_type = 'page_view' AND page_key IS NOT NULL)
    OR (event_type IN ('login', 'logout') AND page_key IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created
  ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_created
  ON analytics_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_created
  ON analytics_events(event_type, created_at DESC);

-- ************************ PERSISTENT COMMUNITY LOUNGE ************************ --
CREATE TABLE IF NOT EXISTS lounge_rooms (
  room_id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO lounge_rooms (slug, name)
VALUES ('community-lounge', 'Community Lounge')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS lounge_messages (
  message_id BIGSERIAL PRIMARY KEY,
  room_id INT NOT NULL REFERENCES lounge_rooms(room_id),
  author_id INT REFERENCES users(user_id) ON DELETE SET NULL,
  author_username TEXT NOT NULL,
  body TEXT NOT NULL CHECK (LENGTH(TRIM(body)) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by INT REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lounge_messages_room_created
  ON lounge_messages(room_id, message_id DESC);

CREATE TABLE IF NOT EXISTS lounge_reads (
  room_id INT NOT NULL REFERENCES lounge_rooms(room_id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  last_read_message_id BIGINT REFERENCES lounge_messages(message_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

-- Keep schema setup compatible with existing Lounge installations.
ALTER TABLE lounge_rooms ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL
  DEFAULT 'members' CHECK (access_level IN ('members', 'staff'));
INSERT INTO lounge_rooms (slug, name, access_level)
VALUES ('staff-chat', 'Staff Chat', 'staff')
ON CONFLICT (slug) DO NOTHING;


-- ********************* EDITABLE MARKETING PAGE CONTENT ********************* --

CREATE TABLE IF NOT EXISTS faq2_pages (
  page_key TEXT PRIMARY KEY CHECK (page_key = 'faq2'),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discount_pages (
  page_key TEXT PRIMARY KEY CHECK (page_key = 'discountlinks2'),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Staff-only forum category and alert suppression.
ALTER TABLE forum_categories ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL
  DEFAULT 'members' CHECK (access_level IN ('members', 'staff'));
INSERT INTO forum_categories(name, slug, description, sort_order, access_level)
VALUES ('Staff Announcements', 'staff-announcements', 'Private guidelines and updates for the staff team.', 2, 'staff')
ON CONFLICT (slug) DO NOTHING;

-- Suppress every type of staff-post alert, including the existing new-post trigger.
CREATE OR REPLACE FUNCTION suppress_staff_forum_notifications()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM posts p JOIN forum_categories c ON c.category_id = p.category_id
    WHERE p.post_id = COALESCE(NEW.post_id, (SELECT post_id FROM comments WHERE comment_id = NEW.comment_id))
      AND (c.access_level = 'staff' OR c.slug = 'staff-announcements')
  ) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS suppress_staff_forum_notifications_trigger ON notifications;
CREATE TRIGGER suppress_staff_forum_notifications_trigger
BEFORE INSERT OR UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION suppress_staff_forum_notifications();

-- Editable public Resources content; initial content is never overwritten.
CREATE TABLE IF NOT EXISTS resource_pages (
  page_key TEXT PRIMARY KEY CHECK (page_key = 'resources'),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO resource_pages (page_key, content)
VALUES ('resources', $resources${
  "hero": {
    "kicker": "The recovery field guide",
    "title": "Information for finding your own way.",
    "intro": "Research, lived experience, and outside support—collected carefully so the next useful direction is easier to find."
  },
  "learnIntro": "A starting point, not a substitute for medical advice. These are articles, studies, and videos members have found useful over the years.",
  "supportIntro": "We're rebuilding this directory of independent organizations — not part of Recovery With The Exit Drug — to make sure it stays current and accurate.",
  "categories": [
    {
      "id": "substitution",
      "title": "Substitution & Harm Reduction",
      "section": "learn",
      "links": [
        {
          "id": "substitution-1",
          "text": "Can We Unlock Marijuana's Potential as an \"Exit Drug\"?",
          "url": "http://www.substance.com/can-we-unlock-marijuanas-potential-as-an-exit-drug/8312/",
          "tag": ""
        },
        {
          "id": "substitution-2",
          "text": "Considering Marijuana Maintenance: Cannabis as a Substitution Therapy for Alcoholism",
          "url": "http://www.choosehelp.com/topics/harm-reduction/marijuana-cannabis-substitution-alcoholism",
          "tag": ""
        },
        {
          "id": "substitution-3",
          "text": "\"Marijuana Recovery\": The newest option for recovering substance addicts?",
          "url": "https://www.psychologytoday.com/blog/addiction-beat/201307/marijuana-recovery",
          "tag": ""
        },
        {
          "id": "substitution-4",
          "text": "The Likely Cause of Addiction Has Been Discovered, and It Is Not What You Think",
          "url": "http://www.huffingtonpost.com/johann-hari/the-real-cause-of-addicti_b_6506936.html",
          "tag": ""
        },
        {
          "id": "substitution-5",
          "text": "The real 'gateway drug' is 100% legal",
          "url": "https://www.washingtonpost.com/news/wonk/wp/2016/01/06/the-real-gateway-drug-thats-everywhere-and-legal/?postshare=9281452192404656&tid=ss_fb-bottom",
          "tag": ""
        },
        {
          "id": "substitution-6",
          "text": "What is harm reduction? (Harm Reduction International)",
          "url": "http://www.ihra.net/what-is-harm-reduction",
          "tag": ""
        },
        {
          "id": "substitution-7",
          "text": "A safer alternative: Cannabis substitution as harm reduction",
          "url": "http://www.ncbi.nlm.nih.gov/pubmed/25919477?report=abstract",
          "tag": ""
        },
        {
          "id": "substitution-8",
          "text": "Can Cannabis Be Considered a Substitute Medication for Alcohol?",
          "url": "http://www.medscape.com/viewarticle/825298",
          "tag": ""
        },
        {
          "id": "substitution-9",
          "text": "Cannabis Substitution: Harm Reduction Treatment for Alcoholism and Drug Dependence (Tod H. Mikuriya, MD & Jerry Mandel, PhD)",
          "url": "http://mikuriyamedical.com/about/cw_cansub.html",
          "tag": ""
        },
        {
          "id": "substitution-10",
          "text": "Cannabis Substitution: Marijuana Maintenance as Addiction Treatment (Featuring: Amanda Reiman, PhD and Kenneth Anderson, MA)",
          "url": "https://youtu.be/6Nt5ZXtX4Ts",
          "tag": "Video"
        },
        {
          "id": "substitution-11",
          "text": "Everything We Think We Know About Addiction Is Wrong",
          "url": "https://youtu.be/ao8L-0nSYzg",
          "tag": "Video"
        }
      ]
    },
    {
      "id": "alcohol",
      "title": "Alcohol-Specific",
      "section": "learn",
      "links": [
        {
          "id": "alcohol-1",
          "text": "Medical Marijuana and Alcoholism",
          "url": "https://www.whaxy.com/learn/cannabis-treament-for-alcoholism",
          "tag": ""
        },
        {
          "id": "alcohol-2",
          "text": "Study Shows Marijuana Often Substituted for Alcohol and Other Drugs",
          "url": "http://blog.mpp.org/research/study-shows-marijuana-often-substituted-for-alcohol-and-other-drugs/",
          "tag": ""
        },
        {
          "id": "alcohol-3",
          "text": "Cannabis as a Substitute for Alcohol: A Harm-Reduction Approach (Tod H. Mikuriya, MD)",
          "url": "http://mikuriyamedical.com/about/cw_alcsub.pdf",
          "tag": ""
        },
        {
          "id": "alcohol-4",
          "text": "Marijuana Maintenance: Cannabis for Alcohol Dependence (Featuring Kenneth Anderson of HAMS Network)",
          "url": "https://www.youtube.com/watch?v=bXM5YpR0Gf4",
          "tag": "Video"
        },
        {
          "id": "alcohol-5",
          "text": "smoking weed in AA",
          "url": "http://www.bluelight.org/vb/threads/679991-smoking-weed-in-AA",
          "tag": "Forum"
        },
        {
          "id": "alcohol-6",
          "text": "The Alcoholic Fights for His Herb by \"Mr. W.\"",
          "url": "http://marijuana-uses.com/the-alcoholic-fights-for-his-herb/",
          "tag": "Forum"
        }
      ]
    },
    {
      "id": "opioid",
      "title": "Opioid-Specific",
      "section": "learn",
      "links": [
        {
          "id": "opioid-1",
          "text": "Can Medical Marijuana Curb Heroin Addiction?",
          "url": "http://www.alternet.org/drugs/medical-marijuana-cure-heroin-epidemic",
          "tag": ""
        },
        {
          "id": "opioid-2",
          "text": "Marijuana Use Helped Me Kick My Opiate Addiction — It Could Help Others",
          "url": "http://reset.me/story/marijuana-use-increasingly-accepted-12-step-programs/",
          "tag": ""
        },
        {
          "id": "opioid-3",
          "text": "Opioid Addiction Being Treated With Medical Marijuana in Massachusetts",
          "url": "http://www.drugfree.org/join-together/opioid-addiction-treated-medical-marijuana-massachusetts/",
          "tag": ""
        },
        {
          "id": "opioid-4",
          "text": "Trading Opiates for Marijuana to Treat Pain",
          "url": "http://www.doctoroz.com/episode/trading-opiates-marijuana-treat-pain",
          "tag": "Video"
        }
      ]
    },
    {
      "id": "personal",
      "title": "Personal Accounts",
      "section": "learn",
      "links": [
        {
          "id": "personal-1",
          "text": "How I Smoked My Way Sober",
          "url": "http://www.buzzfeed.com/katieherzog/how-i-smoked-my-way-sober?utm_term=.qtEr2l0nK#.muQkQ0doe",
          "tag": ""
        },
        {
          "id": "personal-2",
          "text": "Secret \"Sober\" Pot Smokers",
          "url": "https://www.thefix.com/content/secret-%E2%80%9Csober%E2%80%9D-pot-users2030",
          "tag": ""
        }
      ]
    },
    {
      "id": "research",
      "title": "Research & Safety",
      "section": "learn",
      "links": [
        {
          "id": "research-1",
          "text": "Here's How Many People Fatally Overdosed on Marijuana Last Year (2015)",
          "url": "http://www.huffingtonpost.com/entry/marijuana-deaths-2014_56814617e4b06fa68880a217",
          "tag": ""
        },
        {
          "id": "research-2",
          "text": "Study: Patients Substitute Cannabis For Booze, Prescription Drugs",
          "url": "http://norml.org/news/2015/10/08/study-patients-substitute-cannabis-for-booze-prescription-drugs",
          "tag": ""
        },
        {
          "id": "research-3",
          "text": "The science behind cannabinoids is clear: marijuana helps brain achieve breakthroughs in learning, consciousness and understanding",
          "url": "http://www.naturalnews.com/051164_cannabinoids_mental_capacity_marijuana.html",
          "tag": ""
        },
        {
          "id": "research-4",
          "text": "Using Medical Marijuana Doesn't Increase Risk of Drug Abuse, Study Concludes",
          "url": "http://www.healthline.com/health-news/using-medical-marijuana-doesnt-increase-risk-of-drug-abuse-051815#1",
          "tag": ""
        },
        {
          "id": "research-5",
          "text": "Pregnenolone Can Protect the Brain from Cannabis Intoxication",
          "url": "http://science.sciencemag.org/content/343/6166/94",
          "tag": ""
        },
        {
          "id": "research-6",
          "text": "Use of prescription pain medications among medical cannabis patients: comparisons of pain levels, functioning, and patterns of alcohol and other drug use.",
          "url": "http://www.ncbi.nlm.nih.gov/pubmed/25978826",
          "tag": ""
        },
        {
          "id": "research-7",
          "text": "Dr. Oz & Dr. Devi Nampiaparampil on Using Marijuana for Pain",
          "url": "http://www.doctoroz.com/episode/trading-opiates-marijuana-treat-pain",
          "tag": "Video"
        }
      ]
    }
  ]
}$resources$::jsonb)
ON CONFLICT (page_key) DO NOTHING;

-- Home - Test is independent of the unchanged static Home page.
CREATE TABLE IF NOT EXISTS home_test_pages (
  page_key TEXT PRIMARY KEY CHECK (page_key = 'home-test'),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO home_test_pages (page_key, content)
VALUES ('home-test', $home_test${
  "hero": {
    "established": "EST.",
    "year": "2013",
    "titleFirst": "Recovery with",
    "titleSecond": "The Exit-Drug",
    "former": "Formerly known as Maintaining My Recovery with Cannabis (MMRC)",
    "description": "A recovery support community for people using cannabis to reduce or replace dangerous and addictive substances. Find peer support, educational resources, recovery stories, and connection without judgment."
  },
  "purpose": {
    "kicker": "Our founding purpose",
    "mission": "The mission of Recovery with The Exit-Drug (formerly known as Maintaining My Recovery with Cannabis/MMRC) is to develop a recovery support community of people who use cannabis as a form of harm-reduction therapy from dangerous or addictive substances. We provide support through personal experiences, educational resources, and peer support programs—while upholding a culture of inclusiveness and mutual respect.",
    "supportText": "Help support our nonprofit organization through monetary gifts, our Etsy store & our affiliate discount codes."
  },
  "principles": {
    "kicker": "What we are rooted in",
    "title": "Principles We Uphold",
    "intro": "The following principles are what guide and shape our mission.",
    "title1": "Harm-Reduction Saves Lives",
    "text1": "We promote harm-reduction that is an evidence-based approach to address substance use disorders through prevention, treatment, and recovery that ‘meets people where they are at’ with dignity, kindness and respect regardless of condition or circumstance.",
    "title2": "Recovery has Many Pathways",
    "text2": "We recognize that recovery is deeply personal and what works for one person may not work for another. Approaching all recovery methods with openness and without judgment is far more effective than shaming someone because their path to recovery looks different from the traditional approach.",
    "title3": "Medication-Assisted-Treatment (MAT) & Plant-Medicine is Health Care",
    "text3": "These modalities are healthcare because they treat substance use disorders and mental health as real medical conditions. They use science, clinical evidence, and history to heal the brain and the body.",
    "title4": "Connection & Compassion Heal; Shame & Stigma Hurt",
    "text4": "By placing compassion and connection at the center of recovery, we can help foster healing while also contributing to a broader cultural shift from shame and stigma toward understanding and support."
  },
  "provides": {
    "kicker": "Creating an impact",
    "title": "What We Provide",
    "intro": "The following resources offer compassionate support, meaningful connections, and helpful information.",
    "title1": "Peer support group",
    "text1": "A first of its kind moderated community support forum of like-minded individuals sharing personal experience about cannabis and recovery.",
    "title2": "Education",
    "text2": "A list of informational articles, scientific research, and other resources to learn about cannabis, recovery and more.",
    "title3": "Recovery Stories",
    "text3": "Real voices publicly sharing their journeys of recovery with cannabis to help inspire others.",
    "title4": "Future projects",
    "text4": "We are always growing to add additional features that will benefit our community."
  },
  "social": {
    "kicker": "Stay connected",
    "title": "Help our community grow.",
    "intro": "Follow us for recovery encouragement, community updates, and stories worth sharing. Sharing our posts can help others find support here.",
    "facebookTitle": "Facebook",
    "facebookText": "Community updates and recovery encouragement.",
    "instagramTitle": "Instagram",
    "instagramText": "Stories, inspiration, and educational posts."
  },
  "disclaimer": {
    "label": "Disclaimer",
    "text": "Recovery with The Exit Drug is a volunteer support group sharing practical information. This is not a professional or medical organization. The information provided is for informational and educational purposes only and is not a substitute for professional care."
  }
}$home_test$::jsonb)
ON CONFLICT (page_key) DO NOTHING;

-- Editable Guidelines, seeded without overwriting saved rules.
CREATE TABLE IF NOT EXISTS guidelines_pages (
 page_key TEXT PRIMARY KEY CHECK (page_key = 'guidelines'),
 content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
 revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
 updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO guidelines_pages (page_key, content)
VALUES ('guidelines', $guidelines${
  "page": {
    "eyebrow": "Our community culture",
    "title": "GUIDELINES",
    "intro": "All members must agree to follow these guidelines and acknowledge the disclaimer below:",
    "sideLabel": "What holds us together",
    "sideTitle1": "Trust.",
    "sideTitle2": "Privacy.",
    "sideTitle3": "Respect.",
    "sideText": "These guidelines protect our community and help everyone feel safe, supported, and able to be honest.",
    "charterLabel": "Community charter",
    "contactLead": "Please contact our Admin,",
    "contactName": "Lainie Ruth",
    "contactTail": "with any questions or concerns.",
    "disclaimerLabel": "Disclaimer:",
    "disclaimerText": "Recovery with The Exit Drug’s private forum is a free peer-to-peer support group. This is not a professional or medical organization. Anything provided in this group forum is for supportive and informational purposes only. We are not a substitute for professional or medical care."
  },
  "items": [
    {
      "id": "01",
      "icon": "LockKeyhole",
      "title": "Respect Everyone’s Privacy — What’s Shared Stays in the Private Group Forum",
      "text": "Protecting the privacy and trust of every member is essential to maintaining a safe environment. Please do not share, repeat, screenshot, copy, or distribute another member’s posts, comments, personal experiences, or identifying information outside of our group forum. What members share here should stay here. Please note that sharing information online may involve certain risks."
    },
    {
      "id": "02",
      "icon": "Heart",
      "title": "Be Kind and Considerate",
      "text": "Treat everyone with kindness, consideration and compassion. Always be mindful of another member’s feelings and communicate respectfully. Differences in opinions and experiences are welcome, but personal attacks are not. We’re here to support one another, not judge or criticize."
    },
    {
      "id": "03",
      "icon": "UsersRound",
      "title": "We Are Non-Judgmental & All-Inclusive",
      "text": "We remain non-judgmental and all-inclusive towards all members at all times. All member posts and comments should refrain from using profanity, jokes, sarcasm, disrespect and negativity that could incite offense to another member. We may not always see eye to eye, and that’s okay. Let’s agree to disagree with care and understanding."
    },
    {
      "id": "04",
      "icon": "MegaphoneOff",
      "title": "No Sales, Promotions, Spam or Unsolicited Advice",
      "text": "We do not post spam, advertisements, promotional content, sales, irrelevant links or unsolicited advice. This includes, but is not limited to, promoting or selling products, businesses, or services of any kind."
    },
    {
      "id": "05",
      "icon": "Ban",
      "title": "No Illegal Activity",
      "text": "Do not use our service for any unlawful purposes. We do not endorse going against your current local laws regarding substance use or possession. We are not here to advise on how to circumvent the law. Posts asking about how to pass a drug test or the likelihood of success in a criminal act are prohibited. Do not post information on how to smuggle, ship, hide, manufacture, or distribute illegal substances."
    },
    {
      "id": "06",
      "icon": "MessageCircle",
      "title": "Stay on Topic",
      "text": "Our group forum is intended only to provide a supportive space for members to share their personal experiences, challenges, questions, and insights related to cannabis, substance use, addiction, and recovery. We do not allow discussions centered on religion, politics, or other unrelated subjects."
    },
    {
      "id": "07",
      "icon": "Image",
      "title": "Image & Meme Sharing",
      "text": "Any sharing of an image or meme must be accompanied by original written text from the member posting. All images and memes posted alone, that go against guidelines or are off-topic will be declined."
    },
    {
      "id": "08",
      "icon": "ShieldCheck",
      "title": "Admin & Moderators",
      "text": "The admin/moderators are here to closely facilitate activity and uphold group forum guidelines. They reserve the right to remove membership, posts, and comments due to noncompliance with the rules. Please note that moderators are generous volunteers and are not paid professionals. For any questions or concerns, all members may contact the Admin, Lainie Ruth, through private message or on the “Contact Us” page."
    }
  ]
}$guidelines$::jsonb)
ON CONFLICT (page_key) DO NOTHING;
