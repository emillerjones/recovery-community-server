BEGIN;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS welcome_member_id INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_welcome_member_id_fkey'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_welcome_member_id_fkey
      FOREIGN KEY (welcome_member_id) REFERENCES users(user_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_welcome_member_id_unique'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_welcome_member_id_unique UNIQUE (welcome_member_id);
  END IF;
END $$;

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

COMMIT;
