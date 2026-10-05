BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE lounge_rooms ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL
  DEFAULT 'members' CHECK (access_level IN ('members', 'staff'));

INSERT INTO lounge_rooms (slug, name, access_level)
VALUES ('staff-chat', 'Staff Chat', 'staff')
ON CONFLICT (slug) DO NOTHING;

COMMIT;
