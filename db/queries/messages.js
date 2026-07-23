import db from "#db/client";

/** Finds the conversation between two users, creating it if it doesn't exist yet. */
export async function getOrCreateConversation(userIdA, userIdB) {
  const userOneId = Math.min(userIdA, userIdB);
  const userTwoId = Math.max(userIdA, userIdB);

  const {
    rows: [conversation],
  } = await db.query(
    `
      INSERT INTO direct_conversations (user_one_id, user_two_id)
      VALUES ($1, $2)
      ON CONFLICT (user_one_id, user_two_id) DO UPDATE
        SET user_one_id = EXCLUDED.user_one_id
      RETURNING *
    `,
    [userOneId, userTwoId]
  );
  return conversation;
}

/** Returns a conversation only if the given user is one of its two participants. */
export async function getConversationForParticipant(conversationId, userId) {
  const {
    rows: [conversation],
  } = await db.query(
    `
      SELECT *
      FROM direct_conversations
      WHERE conversation_id = $1
        AND (user_one_id = $2 OR user_two_id = $2)
    `,
    [conversationId, userId]
  );
  return conversation;
}

export async function getConversationsForUser(userId) {
  const { rows } = await db.query(
    `
      SELECT
        c.conversation_id,
        other.user_id AS other_user_id,
        other.username AS other_username,
        other.avatar_url AS other_avatar_url,
        last_message.body AS last_message_body,
        last_message.created_at AS last_message_at,
        last_message.sender_id AS last_message_sender_id,
        COUNT(unread.message_id)::INT AS unread_count
      FROM direct_conversations c
      JOIN users other
        ON other.user_id = CASE WHEN c.user_one_id = $1 THEN c.user_two_id ELSE c.user_one_id END
      LEFT JOIN LATERAL (
        SELECT body, created_at, sender_id
        FROM direct_messages
        WHERE conversation_id = c.conversation_id
        ORDER BY created_at DESC
        LIMIT 1
      ) last_message ON TRUE
      LEFT JOIN direct_messages unread
        ON unread.conversation_id = c.conversation_id
        AND unread.sender_id <> $1
        AND unread.read_at IS NULL
      WHERE c.user_one_id = $1 OR c.user_two_id = $1
      GROUP BY c.conversation_id, other.user_id, last_message.body, last_message.created_at, last_message.sender_id
      ORDER BY COALESCE(last_message.created_at, c.created_at) DESC
    `,
    [userId]
  );
  return rows;
}

export async function getMessages(conversationId, limit = 100) {
  const { rows } = await db.query(
    `
      SELECT
        m.*,
        u.username AS sender_username,
        u.avatar_url AS sender_avatar_url
      FROM direct_messages m
      JOIN users u ON u.user_id = m.sender_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at
      LIMIT $2
    `,
    [conversationId, limit]
  );
  return rows;
}

export async function sendMessage({ conversationId, senderId, body }) {
  const {
    rows: [message],
  } = await db.query(
    `
      WITH inserted AS (
        INSERT INTO direct_messages (conversation_id, sender_id, body)
        VALUES ($1, $2, $3)
        RETURNING *
      )
      SELECT inserted.*, u.username AS sender_username, u.avatar_url AS sender_avatar_url
      FROM inserted
      JOIN users u ON u.user_id = inserted.sender_id
    `,
    [conversationId, senderId, body.trim()]
  );
  return message;
}

export async function markConversationRead(conversationId, viewerId) {
  await db.query(
    `
      UPDATE direct_messages
      SET read_at = NOW()
      WHERE conversation_id = $1
        AND sender_id <> $2
        AND read_at IS NULL
    `,
    [conversationId, viewerId]
  );
}

export async function getUnreadMessageCount(userId) {
  const {
    rows: [{ count }],
  } = await db.query(
    `
      SELECT COUNT(*)::INT AS count
      FROM direct_messages m
      JOIN direct_conversations c ON c.conversation_id = m.conversation_id
      WHERE (c.user_one_id = $1 OR c.user_two_id = $1)
        AND m.sender_id <> $1
        AND m.read_at IS NULL
    `,
    [userId]
  );
  return count;
}
