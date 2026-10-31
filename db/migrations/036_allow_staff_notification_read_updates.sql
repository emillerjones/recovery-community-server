BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION suppress_staff_forum_notifications()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- A public post may have generated alerts before it was moved to staff-only.
  -- Permit acknowledging those existing alerts, but not changing their content,
  -- recipient, actor, target, or resetting them to unread.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.read_at IS NOT NULL
      AND (to_jsonb(NEW) - 'read_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'read_at')
    THEN RETURN NEW; END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM posts p JOIN forum_categories c ON c.category_id = p.category_id
    WHERE p.post_id = COALESCE(NEW.post_id, (SELECT post_id FROM comments WHERE comment_id = NEW.comment_id))
      AND (c.access_level = 'staff' OR c.slug = 'staff-announcements')
  ) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;
COMMIT;
