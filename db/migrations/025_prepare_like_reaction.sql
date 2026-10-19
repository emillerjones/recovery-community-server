BEGIN;
SET LOCAL lock_timeout = '5s';

-- Expand first, while the previous server still writes agree. Preserve the
-- existing allowed types, including any historical encouragement records.
DO $$
DECLARE existing_rule TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO STRICT existing_rule
  FROM pg_constraint WHERE conrelid = 'forum_reactions'::regclass
    AND conname = 'forum_reactions_reaction_type_check';
  IF position('''like''' IN existing_rule) = 0 THEN
    ALTER TABLE forum_reactions DROP CONSTRAINT forum_reactions_reaction_type_check;
    EXECUTE 'ALTER TABLE forum_reactions ADD CONSTRAINT forum_reactions_reaction_type_check CHECK ('
      || substring(existing_rule FROM 7)
      || ' OR reaction_type = ''like'')';
  END IF;
END $$;
COMMIT;
