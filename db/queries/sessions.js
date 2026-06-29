import db from "#db/client";
import bcrypt from "bcrypt";

export async function getSessions(){
  const sql = `
    SELECT sessions.*, games.game_title, games.cover_image_url
    FROM sessions
    JOIN games ON sessions.game_id = games.game_id
  `;
  const { rows: games } = await db.query(sql);
  return games;
}

export async function getSessionById(session_id) {
  const sql = `
    SELECT sessions.*, games.game_title, games.cover_image_url
    FROM sessions
    JOIN games ON sessions.game_id = games.game_id
    WHERE session_id = $1
  `;
  const { rows: [session] } = await db.query(sql, [session_id]);
  return session;
}

export async function getSessionUsers(session_id) {
  const sql = `
    SELECT session_users.membership_status, session_users.is_host, users.user_id, users.username, users.avatar_url, users.xbox_gamertag
    FROM session_users 
    JOIN users ON session_users.user_id = users.user_id 
    WHERE session_id = $1 
  `;
  const { rows } = await db.query(sql, [session_id]);
  return rows;
}

// MATCHMAKING SCRIPT UPGRADE: Saves the initial matchmaking intake flag state
export async function createSession(sessionData) {
  const { game_id, host_user_id, session_title, session_description, max_users, is_private, matchmaking_enabled, playstyle } = sessionData;
  
  const sql = `
    INSERT INTO sessions (
      game_id, 
      host_user_id, 
      session_title, 
      session_description, 
      max_users, 
      created_by_user_id, 
      is_private, 
      matchmaking_enabled,
      playstyle
    )
    VALUES ($1, $2, $3, $4, $5, $2, $6, $7, $8)
    RETURNING *;
  `;
  
  const { rows: [session] } = await db.query(sql, [
    game_id,
    host_user_id,
    session_title,
    session_description || "No description provided.",
    max_users || 4,
    is_private ?? false,
    matchmaking_enabled ?? false,
    playstyle || 'Casual'
  ]);
  
  return session;
}

export async function deleteSession(sessionId) {
  const sql = `
    DELETE FROM sessions WHERE session_id = $1 RETURNING *;
  `;
  const { rows: [deletedSession] } = await db.query(sql, [sessionId]);
  return deletedSession;
}

// MATCHMAKING SCRIPT UPGRADE: Updates dynamic status parameters and queue positions
export async function updateSession(sessionId, sessionData) {
  const { session_title, session_description, max_users, session_status, matchmaking_enabled, playstyle } = sessionData;
  const sql = `
    UPDATE sessions 
    SET session_title = $2, 
        session_description = $3, 
        max_users = $4, 
        session_status = $5,
        matchmaking_enabled = $6, -- Hot-swaps queue availability live from the dashboard
        updated_at = NOW()
    WHERE session_id = $1
    RETURNING *;
  `;
  const { rows: [updatedSession] } = await db.query(sql, [
    sessionId,
    session_title,
    session_description,
    max_users || 4,
    session_status || 'active',
    matchmaking_enabled ?? false
  ]);
  return updatedSession;
}

export async function getSessionsByGameId(gameId) {
  const sql = `
    SELECT * FROM sessions WHERE game_id = $1;
  `;
  const { rows: sessions } = await db.query(sql, [gameId]);
  return sessions;
}

export async function getSessionsByHostUserId(hostUserId) {
  const sql = `
    SELECT * FROM sessions WHERE host_user_id = $1;
  `;
  const { rows: sessions } = await db.query(sql, [hostUserId]);
  return sessions;
}

export async function getSessionsByUserId(userId) {
  const sql = `
    SELECT s.* FROM sessions s JOIN session_users su ON s.session_id = su.session_id WHERE su.user_id = $1;
  `;
  const { rows: sessions } = await db.query(sql, [userId]);
  return sessions;
}

export async function addUserToSession(sessionId, userId) {
  const sql = `
    INSERT INTO session_users (session_id, user_id) VALUES ($1, $2) RETURNING *;
  `;
  const { rows: [sessionUser] } = await db.query(sql, [sessionId, userId]);
  return sessionUser;
}

export async function removeUserFromSession(sessionId, userId) {
  const sql = `
    DELETE FROM session_users WHERE session_id = $1 AND user_id = $2 RETURNING *;
  `;
  const { rows: [removedSessionUser] } = await db.query(sql, [sessionId, userId]);
  return removedSessionUser;
}
