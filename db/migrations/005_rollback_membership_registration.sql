-- Run this only when intentionally removing the membership-registration feature.
-- It deletes application/invitation/token data, but leaves all pre-existing
-- users, forum posts, comments, reactions, messages, and mentions intact.
BEGIN;

DROP TABLE IF EXISTS email_verification_tokens;
DROP TABLE IF EXISTS membership_applications;
DROP TABLE IF EXISTS shared_invite_codes;
DROP TABLE IF EXISTS personal_invites;

ALTER TABLE users
  DROP COLUMN IF EXISTS email_verified_at,
  DROP COLUMN IF EXISTS account_status;

COMMIT;
