import db from "#db/client";
import bcrypt from "bcrypt";

export async function getUsers() {
  const sql = `
    SELECT * 
    FROM users
    WHERE users.deleted_at IS NULL
  `;
  const { rows: users } = await db.query(sql);
  return users;
}

export async function createUser(email, username, password, role_id = 100) {
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
  `;
  const { rows: [user]} = await db.query(sql, [username]);
  return user;
}

export async function getUserByEmailAndPassword(email, password) {
  const sql = `
    SELECT *
    FROM users
    WHERE email = $1 AND users.deleted_at IS NULL
  `;

  const {
    rows: [user],
  } = await db.query(sql, [email]);

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
