BEGIN;

-- Encouragement overlaps too closely with Support. Convert existing selections
-- before tightening the allowed reaction list so nobody's reaction is lost.
ALTER TABLE forum_reactions
  DROP CONSTRAINT IF EXISTS forum_reactions_reaction_type_check;

UPDATE forum_reactions
SET reaction_type = 'support',
    updated_at = NOW()
WHERE reaction_type = 'encouragement';

ALTER TABLE forum_reactions
  ADD CONSTRAINT forum_reactions_reaction_type_check
  CHECK (reaction_type IN (
    'support', 'agree', 'relate', 'helpful',
    'celebrate', 'inspiring', 'care'
  ));

COMMIT;
