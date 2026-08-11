BEGIN;

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

COMMIT;
