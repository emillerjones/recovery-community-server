import db from "#db/client";
import bcrypt from "bcrypt";

const USER_AND_APPLICATION = `
  inserted_user AS (
    INSERT INTO users (
      email, username, password, role_id, account_status, email_verified_at
    )
    SELECT $1, $2, $3, 100,
      CASE WHEN $6 = 'personal_invite' THEN 'approved' ELSE 'unverified' END,
      CASE WHEN $6 = 'personal_invite' THEN NOW() ELSE NULL END
    FROM admission_source
    RETURNING user_id, email, username, account_status
  ),
  inserted_application AS (
    INSERT INTO membership_applications (
      user_id, reason_for_joining, how_did_you_find_us, admission_method,
      personal_invite_id, shared_code_id, agreed_to_rules_at, agreed_to_privacy_at
    )
    SELECT user_id, $4, $5, $6, source_invite_id, source_code_id, NOW(), NOW()
    FROM inserted_user CROSS JOIN admission_source
  ),
  inserted_token AS (
    INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
    SELECT user_id, $7, NOW() + INTERVAL '24 hours' FROM inserted_user
    WHERE $6 <> 'personal_invite'
  ),
  marked_personal_invite AS (
    UPDATE personal_invites pi
    SET used_by = inserted_user.user_id
    FROM inserted_user, admission_source
    WHERE pi.invite_id = admission_source.source_invite_id
  )
  SELECT * FROM inserted_user
`;

/**
 * REGISTRATION TRACE: the public route validates the form, then lands here.
 * Each branch is ONE PostgreSQL statement: claiming an invite/code and creating
 * the user/application all succeed or all roll back. A personal emailed invite
 * already proves email access, so only the other two paths create another token.
 */
export async function createRegistration({
  email, username, password, reasonForJoining, howFound, admissionMethod,
  tokenHash, sourceHash,
}) {
  const hashedPassword = await bcrypt.hash(password, 10);
  let sourceSql;

  if (admissionMethod === "personal_invite") {
    sourceSql = `
      WITH admission_source AS (
        UPDATE personal_invites
        SET used_at = NOW()
        WHERE token_hash = $8 AND LOWER(email) = $1 AND used_at IS NULL
          AND revoked_at IS NULL AND expires_at > NOW()
        RETURNING invite_id AS source_invite_id, NULL::INT AS source_code_id
      ), ${USER_AND_APPLICATION}
    `;
  } else if (admissionMethod === "shared_code") {
    sourceSql = `
      WITH admission_source AS (
        UPDATE shared_invite_codes
        SET use_count = use_count + 1, updated_at = NOW()
        WHERE code_hash = $8 AND active = TRUE AND expires_at > NOW()
          AND (max_uses IS NULL OR use_count < max_uses)
        RETURNING NULL::INT AS source_invite_id, code_id AS source_code_id
      ), ${USER_AND_APPLICATION}
    `;
  } else {
    sourceSql = `
      WITH admission_source AS (
        SELECT NULL::INT AS source_invite_id, NULL::INT AS source_code_id
      ), ${USER_AND_APPLICATION}
    `;
  }

  const values = [email, username, hashedPassword, reasonForJoining, howFound,
    admissionMethod, tokenHash];
  if (admissionMethod !== "standard") values.push(sourceHash);
  const { rows: [user] } = await db.query(sourceSql, values);
  return user;
}

export async function getInvitePreview(tokenHash) {
  const { rows: [invite] } = await db.query(
    `SELECT email, expires_at FROM personal_invites
     WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
    [tokenHash]
  );
  return invite;
}

export async function replaceVerificationToken(email, tokenHash) {
  const { rows: [user] } = await db.query(
    `WITH target AS (
       SELECT user_id, email, username FROM users
       WHERE email = $1 AND account_status = 'unverified' AND deleted_at IS NULL
     ), expired AS (
       UPDATE email_verification_tokens SET used_at = NOW()
       WHERE user_id = (SELECT user_id FROM target) AND used_at IS NULL
     ), inserted AS (
       INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       SELECT user_id, $2, NOW() + INTERVAL '24 hours' FROM target
     ) SELECT * FROM target`,
    [email, tokenHash]
  );
  return user;
}

export async function verifyEmail(tokenHash) {
  const { rows: [result] } = await db.query(
    `WITH claimed AS (
       UPDATE email_verification_tokens
       SET used_at = NOW()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id
     ), method AS (
       SELECT ma.user_id, ma.admission_method
       FROM membership_applications ma JOIN claimed c ON c.user_id = ma.user_id
     ), updated AS (
       UPDATE users u SET
         email_verified_at = NOW(),
         account_status = CASE WHEN m.admission_method = 'standard' THEN 'pending' ELSE 'approved' END,
         updated_at = NOW()
       FROM method m WHERE u.user_id = m.user_id
       RETURNING u.user_id, u.email, u.username, u.account_status
     ), marked_invite AS (
       UPDATE personal_invites pi SET used_by = u.user_id
       FROM membership_applications ma JOIN updated u ON u.user_id = ma.user_id
       WHERE pi.invite_id = ma.personal_invite_id
     ) SELECT * FROM updated`,
    [tokenHash]
  );
  return result;
}
