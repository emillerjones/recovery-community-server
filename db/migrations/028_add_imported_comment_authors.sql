BEGIN;
SET LOCAL lock_timeout = '5s';
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
COMMIT;
