-- Expands the positive reaction catalog without changing existing reactions.
ALTER TABLE forum_reactions
  DROP CONSTRAINT IF EXISTS forum_reactions_reaction_type_check;

ALTER TABLE forum_reactions
  ADD CONSTRAINT forum_reactions_reaction_type_check
  CHECK (reaction_type IN (
    'support', 'agree', 'relate', 'encouragement',
    'helpful', 'celebrate', 'inspiring', 'care'
  ));
