import db from "#db/client";
// import bcrypt from "bcrypt";

export async function getSessionMessages(session_id){
  const sql = `
  SELECT 
    session_messages.*
    ,users.username 
  FROM session_messages

  JOIN users ON session_messages.user_id = users.user_id
  WHERE session_id = $1
  AND is_deleted = false
  ORDER BY created_at ASC
  `;
  const { rows: messages } = await db.query(sql, [session_id]);
  return messages;
}


export async function createSessionMessage(session_id, user_id, message_text){
  const sql = `
  INSERT INTO session_messages
    (
      session_id
      ,user_id
      ,message_text
    )
  VALUES
    (
      $1,$2,$3
    )
  RETURNING *
  `;
  const { rows: [message] } = await db.query(sql, [session_id, user_id, message_text]);
  return message;
}

export async function deleteSessionMessage(session_message_id, user_id) {
  const sql = `
    UPDATE session_message
    SET 
      is_deleted = true
      ,deleted_at = NOW()
      ,deleted_by = $2
    WHERE session_message_id = $1
    RETURNING *;
  `;
  const { rows: [message] } = await db.query(sql, [session_message_id, user_id]);
  return message;
}