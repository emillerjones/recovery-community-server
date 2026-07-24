import db from "#db/client";

export async function getApplications(status = "pending") {
  const statusSql = status === "all" ? "TRUE" : "u.account_status = $1";
  const values = status === "all" ? [] : [status];
  const { rows } = await db.query(
    `SELECT ma.*, u.email, u.username, u.account_status, u.email_verified_at,
            reviewer.username AS reviewer_username
     FROM membership_applications ma
     JOIN users u ON u.user_id = ma.user_id
     LEFT JOIN users reviewer ON reviewer.user_id = ma.reviewed_by
     WHERE ${statusSql}
     ORDER BY ma.created_at DESC`, values
  );
  return rows;
}

export async function reviewApplication(applicationId, reviewerId, decision, reason) {
  const { rows: [user] } = await db.query(
    `WITH reviewed AS (
       UPDATE membership_applications SET reviewed_by = $2, reviewed_at = NOW(),
         rejection_reason = $4, updated_at = NOW()
       WHERE application_id = $1 AND reviewed_at IS NULL
       RETURNING user_id
     ), updated AS (
       UPDATE users u SET account_status = $3, updated_at = NOW()
       FROM reviewed r WHERE u.user_id = r.user_id AND u.account_status = 'pending'
       RETURNING u.user_id, u.email, u.username, u.account_status
     ) SELECT * FROM updated`,
    [applicationId, reviewerId, decision, reason || null]
  );
  return user;
}

export async function createPersonalInvite({ email, tokenHash, createdBy, expiresAt }) {
  const { rows: [invite] } = await db.query(
    `INSERT INTO personal_invites (email, token_hash, created_by, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING invite_id, email, expires_at, created_at`,
    [email, tokenHash, createdBy, expiresAt]
  );
  return invite;
}

export async function getPersonalInvites() {
  const { rows } = await db.query(
    `SELECT pi.invite_id, pi.email, pi.expires_at, pi.used_at, pi.used_by,
            pi.revoked_at, pi.created_at, creator.username AS created_by_username
     FROM personal_invites pi JOIN users creator ON creator.user_id = pi.created_by
     ORDER BY pi.created_at DESC LIMIT 100`
  );
  return rows;
}

export async function revokePersonalInvite(inviteId) {
  const { rows: [invite] } = await db.query(
    `UPDATE personal_invites SET revoked_at = NOW()
     WHERE invite_id = $1 AND used_at IS NULL RETURNING invite_id`, [inviteId]
  );
  return invite;
}

export async function createSharedCode({ name, codeHash, createdBy, expiresAt, maxUses }) {
  const { rows: [code] } = await db.query(
    `INSERT INTO shared_invite_codes (name, code_hash, created_by, expires_at, max_uses)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING code_id, name, expires_at, max_uses, use_count, active, created_at`,
    [name, codeHash, createdBy, expiresAt, maxUses]
  );
  return code;
}

export async function getSharedCodes() {
  const { rows } = await db.query(
    `SELECT sic.code_id, sic.name, sic.expires_at, sic.active, sic.max_uses,
            sic.use_count, sic.created_at, creator.username AS created_by_username
     FROM shared_invite_codes sic JOIN users creator ON creator.user_id = sic.created_by
     ORDER BY sic.created_at DESC`
  );
  return rows;
}

export async function setSharedCodeActive(codeId, active) {
  const { rows: [code] } = await db.query(
    `UPDATE shared_invite_codes SET active = $2, updated_at = NOW()
     WHERE code_id = $1 RETURNING code_id, active`, [codeId, active]
  );
  return code;
}
