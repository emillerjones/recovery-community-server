BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE users ADD CONSTRAINT users_account_status_check
  CHECK (account_status IN ('unverified', 'pending', 'approved', 'rejected'));

CREATE TABLE IF NOT EXISTS personal_invites (
  invite_id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INT NOT NULL REFERENCES users(user_id),
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  used_by INT REFERENCES users(user_id),
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shared_invite_codes (
  code_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  created_by INT NOT NULL REFERENCES users(user_id),
  expires_at TIMESTAMP NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  max_uses INT CHECK (max_uses IS NULL OR max_uses > 0),
  use_count INT NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS membership_applications (
  application_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  reason_for_joining TEXT NOT NULL,
  how_did_you_find_us TEXT NOT NULL,
  admission_method TEXT NOT NULL
    CHECK (admission_method IN ('standard', 'personal_invite', 'shared_code')),
  personal_invite_id INT REFERENCES personal_invites(invite_id),
  shared_code_id INT REFERENCES shared_invite_codes(code_id),
  agreed_to_rules_at TIMESTAMP NOT NULL,
  agreed_to_privacy_at TIMESTAMP NOT NULL,
  reviewed_by INT REFERENCES users(user_id),
  reviewed_at TIMESTAMP,
  rejection_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT membership_applications_admission_source_check CHECK (
    (admission_method = 'standard' AND personal_invite_id IS NULL AND shared_code_id IS NULL)
    OR (admission_method = 'personal_invite' AND personal_invite_id IS NOT NULL AND shared_code_id IS NULL)
    OR (admission_method = 'shared_code' AND shared_code_id IS NOT NULL AND personal_invite_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  verification_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membership_applications_review_queue
  ON membership_applications(reviewed_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_verification_user_active
  ON email_verification_tokens(user_id, used_at, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_invites_created
  ON personal_invites(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_invite_codes_active
  ON shared_invite_codes(active, expires_at);

COMMIT;
