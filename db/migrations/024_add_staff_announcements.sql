BEGIN;
SET LOCAL lock_timeout = '5s';
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
COMMIT;
