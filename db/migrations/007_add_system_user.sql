BEGIN;

-- The system role is deliberately lower-authority than a member in the
-- numeric role hierarchy. This account never authenticates or moderates; it
-- only provides an honest author identity for automated community content.
INSERT INTO user_roles (role_id, role_name)
VALUES (1000, 'system')
ON CONFLICT (role_id) DO NOTHING;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_system_account
  ON users (is_system)
  WHERE is_system = TRUE;

-- The bcrypt value was produced from a discarded random secret. Combined
-- with the login query's is_system guard, this account has no usable login.
INSERT INTO users (
  role_id, email, password, username, is_system,
  account_status, email_verified_at, avatar_url, notes
)
SELECT
  1000,
  'system@recovery-community.internal',
  '$2b$12$E4ZRwlrYJsDDh.Lnap31IeeH/NKIKfmOBJeDVTK1yrq/F.Cwy08O2',
  'Recovery Community',
  TRUE,
  'approved',
  NOW(),
  'preset:UsersThree:forest',
  'Protected system account for automated community content.'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_system = TRUE)
ON CONFLICT DO NOTHING;

COMMIT;
