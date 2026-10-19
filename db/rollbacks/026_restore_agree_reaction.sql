BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE forum_reactions IN ACCESS EXCLUSIVE MODE;

-- Coordinate with the server rollback: the previous server stores agree.
DO $$
DECLARE existing_rule TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO STRICT existing_rule
  FROM pg_constraint WHERE conrelid = 'forum_reactions'::regclass
    AND conname = 'forum_reactions_reaction_type_check';
  ALTER TABLE forum_reactions DROP CONSTRAINT forum_reactions_reaction_type_check;
  UPDATE forum_reactions SET reaction_type = 'agree' WHERE reaction_type = 'like';
  EXECUTE 'ALTER TABLE forum_reactions ADD CONSTRAINT forum_reactions_reaction_type_check '
    || replace(existing_rule, '''like''', '''agree''');
END $$;
COMMIT;
