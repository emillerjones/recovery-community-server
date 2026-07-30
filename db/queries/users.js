import db from "#db/client";
import bcrypt from "bcrypt";

export async function getUsers() {
  const sql = `
    SELECT * 
    FROM users
    WHERE users.deleted_at IS NULL
      AND users.is_system = FALSE
  `;
  const { rows: users } = await db.query(sql);
  return users;
}

export async function createUser(email, username, password, role_id = 100) {
  email = email.toLowerCase();
  username = username.toLowerCase();
  const sql = `
    INSERT INTO users (email, username, password, role_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const hashedPassword = await bcrypt.hash(password, 10);
  const {
    rows: [user],
  } = await db.query(sql, [email, username, hashedPassword, role_id]);
  return user;
}

export async function getUserById(id) {
  const sql = `
    SELECT * 
    FROM users
    WHERE user_id = $1
  `;
  const {
    rows: [user],
  } = await db.query(sql, [id]);
  return user;
}

export async function getUserByUsername(username) {
  const sql = `
    SELECT *
    FROM users
    WHERE username = $1
      AND is_system = FALSE
      AND account_status = 'approved'
      AND active = TRUE
      AND deleted_at IS NULL
  `;
  const { rows: [user]} = await db.query(sql, [username]);
  return user;
}

export async function searchActiveUsersForMention(search, excludeUserId, limit = 8) {
  // MENTION TRACE STEP 4: The authenticated autocomplete route calls this
  // query. Return only public mention-picker fields—never email or password.
  const { rows } = await db.query(
    `
      SELECT user_id, username, avatar_url
      FROM users
      WHERE active = TRUE
        AND is_system = FALSE
        AND account_status = 'approved'
        AND deleted_at IS NULL
        AND user_id <> $2
        AND username ILIKE $1
      ORDER BY
        CASE WHEN username ILIKE $3 THEN 0 ELSE 1 END,
        username
      LIMIT $4
    `,
    [`%${search}%`, excludeUserId, `${search}%`, limit]
  );
  return rows;
}

export async function getActiveMentionUsers(userIds) {
  if (!userIds.length) return [];
  const { rows } = await db.query(
    `
      SELECT user_id, username
      FROM users
      WHERE user_id = ANY($1::INT[])
        AND is_system = FALSE
        AND active = TRUE
        AND account_status = 'approved'
        AND deleted_at IS NULL
    `,
    [userIds]
  );
  return rows;
}

export async function getUserByEmailAndPassword(email, password) {
  const sql = `
    SELECT *
    FROM users
    WHERE email = $1
      AND users.is_system = FALSE
      AND users.deleted_at IS NULL
  `;

  const {
    rows: [user],
  } = await db.query(sql, [email.toLowerCase()]);

  if (!user) return null;

  const match = await bcrypt.compare(password, user.password);
  if (!match) return null;

  return user;
}

/**
 * These three functions are meant to be added to your existing
 * db/queries/users.js file, alongside getUsers, createUser, etc.
 *
 * Each one is intentionally small and does one thing — update a
 * single column for a single user, then return the updated row so
 * the frontend can immediately show the new state without a second
 * fetch.
 */

/** Updates a user's role_id. Used when an admin promotes/demotes someone. */
export async function updateUserRole(userId, newRoleId) {
  const sql = `
    UPDATE users
    SET role_id = $1, updated_at = NOW()
    WHERE user_id = $2 AND deleted_at IS NULL
    RETURNING *
  `;
  const {
    rows: [user],
  } = await db.query(sql, [newRoleId, userId]);
  return user;
}

/** Sets a user's active flag true/false. Used for deactivate/reactivate. */
export async function setUserActive(userId, active) {
  const sql = `
    UPDATE users
    SET active = $1, updated_at = NOW()
    WHERE user_id = $2 AND deleted_at IS NULL
    RETURNING *
  `;
  const {
    rows: [user],
  } = await db.query(sql, [active, userId]);
  return user;
}

/**
 * Soft-deletes a user by setting deleted_at to the current time.
 * This does NOT remove the row — getUsers() and login already filter
 * out anything where deleted_at IS NOT NULL, so a soft-deleted user
 * effectively disappears from the app without losing their data.
 */
export async function softDeleteUser(userId) {
  const sql = `
    UPDATE users
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE user_id = $1 AND deleted_at IS NULL
    RETURNING *
  `;
  const {
    rows: [user],
  } = await db.query(sql, [userId]);
  return user;
}

/** Updates only the fields a member is allowed to manage on their own profile. */
export async function updateOwnProfile(userId, { bio, phoneNumber, dateOfBirth, gender, avatarUrl }) {
  const { rows: [user] } = await db.query(
    `UPDATE users
     SET bio = $2,
         phone_number = $3,
         date_of_birth = $4,
         gender = $5,
         avatar_url = $6,
         updated_at = NOW()
     WHERE user_id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [userId, bio || null, phoneNumber || null, dateOfBirth || null, gender || null, avatarUrl || null]
  );
  return user;
}

/**
 * Permanently removes an unused member account created while testing signup.
 * This is deliberately one PostgreSQL statement: every cleanup succeeds
 * together, or PostgreSQL leaves the account untouched.
 *
 * Established members are ineligible. We refuse anyone with authored forum
 * content, any direct-message or Lounge activity, staff authority, or
 * admission tools they created. Their community history belongs to others too.
 */
export async function hardDeleteTestUser(userId) {
  const { rows: [deletedUser] } = await db.query(
    `WITH eligible_user AS (
       SELECT u.user_id, u.email, u.username
       FROM users u
       WHERE u.user_id = $1
         AND u.role_id = 100
         AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.user_id)
         AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.author_id = u.user_id)
         AND NOT EXISTS (SELECT 1 FROM lounge_messages lm WHERE lm.author_id = u.user_id)
         AND NOT EXISTS (
           SELECT 1 FROM direct_conversations dc
           JOIN direct_messages dm ON dm.conversation_id = dc.conversation_id
           WHERE dc.user_one_id = u.user_id OR dc.user_two_id = u.user_id
         )
         AND NOT EXISTS (SELECT 1 FROM personal_invites pi WHERE pi.created_by = u.user_id)
         AND NOT EXISTS (SELECT 1 FROM shared_invite_codes sc WHERE sc.created_by = u.user_id)
     ), cleared_flag_reviews AS (
       UPDATE forum_content_flags SET reviewed_by = NULL
       WHERE reviewed_by = (SELECT user_id FROM eligible_user)
     ), deleted_flags AS (
       DELETE FROM forum_content_flags
       WHERE flagged_by = (SELECT user_id FROM eligible_user)
     ), deleted_notifications AS (
       DELETE FROM notifications
       WHERE user_id = (SELECT user_id FROM eligible_user)
          OR actor_id = (SELECT user_id FROM eligible_user)
     ), deleted_mentions AS (
       DELETE FROM forum_mentions
       WHERE mentioned_user_id = (SELECT user_id FROM eligible_user)
          OR mentioned_by = (SELECT user_id FROM eligible_user)
     ), deleted_reactions AS (
       DELETE FROM forum_reactions
       WHERE user_id = (SELECT user_id FROM eligible_user)
     ), deleted_saves AS (
       DELETE FROM forum_saved_posts
       WHERE user_id = (SELECT user_id FROM eligible_user)
     ), deleted_empty_conversations AS (
       DELETE FROM direct_conversations
       WHERE (user_one_id = (SELECT user_id FROM eligible_user)
          OR user_two_id = (SELECT user_id FROM eligible_user))
         AND NOT EXISTS (
           SELECT 1 FROM direct_messages dm
           WHERE dm.conversation_id = direct_conversations.conversation_id
         )
     ), cleared_application_reviews AS (
       UPDATE membership_applications SET reviewed_by = NULL
       WHERE reviewed_by = (SELECT user_id FROM eligible_user)
     ), deleted_tokens AS (
       DELETE FROM email_verification_tokens
       WHERE user_id = (SELECT user_id FROM eligible_user)
     ), deleted_application AS (
       DELETE FROM membership_applications
       WHERE user_id = (SELECT user_id FROM eligible_user)
       RETURNING personal_invite_id, shared_code_id
     ), restored_shared_code AS (
       UPDATE shared_invite_codes sc
       SET use_count = GREATEST(0, use_count - 1), updated_at = NOW()
       FROM deleted_application da
       WHERE sc.code_id = da.shared_code_id
     ), deleted_personal_invite AS (
       DELETE FROM personal_invites pi
       USING deleted_application da
       WHERE pi.invite_id = da.personal_invite_id
     ), deleted_user AS (
       DELETE FROM users u
       USING eligible_user eligible
       WHERE u.user_id = eligible.user_id
       RETURNING u.user_id, u.email, u.username
     )
     SELECT * FROM deleted_user`,
    [userId]
  );
  return deletedUser;
}
