import bcrypt from "bcrypt";
import db from "#db/client";

/** Replaces any unused reset link and returns only the account email details. */
export async function createPasswordResetToken(email, tokenHash) {
  const { rows: [user] } = await db.query(
    `WITH target AS (
       SELECT user_id, email, username
       FROM users
       WHERE email = $1 AND is_system = FALSE AND deleted_at IS NULL
     ), expired AS (
       UPDATE password_reset_tokens SET used_at = NOW()
       WHERE user_id = (SELECT user_id FROM target) AND used_at IS NULL
     ), inserted AS (
       INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       SELECT user_id, $2, NOW() + INTERVAL '1 hour' FROM target
     ) SELECT * FROM target`,
    [email, tokenHash]
  );
  return user;
}

/** Atomically consumes one valid link, changes the password, and revokes sessions. */
export async function resetPassword(tokenHash, password) {
  const hashedPassword = await bcrypt.hash(password, 10);
  const { rows: [user] } = await db.query(
    `WITH claimed AS (
       UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id
     ), updated AS (
       UPDATE users u SET
         password = $2,
         auth_version = auth_version + 1,
         updated_at = NOW()
       FROM claimed c
       WHERE u.user_id = c.user_id AND u.is_system = FALSE AND u.deleted_at IS NULL
       RETURNING u.user_id, u.auth_version
     ), expired AS (
       UPDATE password_reset_tokens SET used_at = NOW()
       WHERE user_id = (SELECT user_id FROM updated)
         AND token_hash <> $1
         AND used_at IS NULL
     ) SELECT * FROM updated`,
    [tokenHash, hashedPassword]
  );
  return user;
}
