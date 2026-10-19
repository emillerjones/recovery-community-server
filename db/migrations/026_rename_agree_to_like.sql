BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE forum_reactions IN ACCESS EXCLUSIVE MODE;

-- Apply after the compatible server is deployed. Change only the type, keeping
-- IDs, targets, users, timestamps, and every other reaction exactly as they are.
DO $$
DECLARE existing_rule TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO STRICT existing_rule
  FROM pg_constraint WHERE conrelid = 'forum_reactions'::regclass
    AND conname = 'forum_reactions_reaction_type_check';
  ALTER TABLE forum_reactions DROP CONSTRAINT forum_reactions_reaction_type_check;
  UPDATE forum_reactions SET reaction_type = 'like' WHERE reaction_type = 'agree';
  EXECUTE 'ALTER TABLE forum_reactions ADD CONSTRAINT forum_reactions_reaction_type_check '
    || replace(existing_rule, '''agree''', '''like''');
END $$;
COMMIT;
