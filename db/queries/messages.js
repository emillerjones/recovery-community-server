import db from "#db/client";

/** Fetches all messages for a specific session with sender details */
export async function getMessagesBySessionId(sessionId) {
  const sql = `
    SELECT 
      sm.session_message_id,
      sm.message_text,
      sm.created_at,
      sm.user_id,
      u.username,
      u.avatar_url
    FROM session_messages sm
    JOIN users u ON sm.user_id = u.user_id
    WHERE sm.session_id = $1 AND sm.is_deleted = false
    ORDER BY sm.created_at ASC;
  `;
  const { rows } = await db.query(sql, [sessionId]);
  return rows;
}

/** Saves a new message to the database */
export async function createMessage(sessionId, userId, text) {
  const sql = `
    INSERT INTO session_messages (session_id, user_id, message_text)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;
  const { rows: [message] } = await db.query(sql, [sessionId, userId, text]);
  return message;
}
