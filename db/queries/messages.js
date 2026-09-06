import db, { withTransaction } from "#db/client";

function messageRuleError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Returns the small, privacy-safe member directory used by the new-message
 * picker. Private profile and account-management fields never leave the DB.
 */
export async function getMessageableMembers(excludeUserId) {
  const { rows } = await db.query(
    `
      SELECT user_id, username, avatar_url
      FROM users
      WHERE account_status = 'approved'
        AND active = TRUE
        AND deleted_at IS NULL
        AND is_system = FALSE
        AND user_id <> $1
      ORDER BY LOWER(username), user_id
    `,
    [excludeUserId]
  );
  return rows;
}

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
        COALESCE(last_message.image_count, 0)::INT AS last_message_image_count,
        COUNT(unread.message_id)::INT AS unread_count
      FROM direct_conversations c
      JOIN users other
        ON other.user_id = CASE WHEN c.user_one_id = $1 THEN c.user_two_id ELSE c.user_one_id END
      LEFT JOIN LATERAL (
        SELECT message.message_id, message.body, message.created_at, message.sender_id,
          (SELECT COUNT(*)::INT
           FROM direct_message_images image
           WHERE image.message_id = message.message_id) AS image_count
        FROM direct_messages message
        WHERE message.conversation_id = c.conversation_id
        ORDER BY message.created_at DESC, message.message_id DESC
        LIMIT 1
      ) last_message ON TRUE
      LEFT JOIN direct_messages unread
        ON unread.conversation_id = c.conversation_id
        AND unread.sender_id <> $1
        AND unread.read_at IS NULL
      WHERE c.user_one_id = $1 OR c.user_two_id = $1
      GROUP BY c.conversation_id, other.user_id, last_message.message_id,
        last_message.body, last_message.created_at, last_message.sender_id,
        last_message.image_count
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
        u.avatar_url AS sender_avatar_url,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'media_id', asset.media_id,
            'width', asset.width,
            'height', asset.height,
            'format', asset.format
          ) ORDER BY image.display_order)
          FROM direct_message_images image
          JOIN media_assets asset ON asset.media_id = image.media_id
          WHERE image.message_id = m.message_id AND asset.status = 'attached'
        ), '[]'::jsonb) AS images
      FROM direct_messages m
      JOIN users u ON u.user_id = m.sender_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at, m.message_id
      LIMIT $2
    `,
    [conversationId, limit]
  );
  return rows;
}

export async function sendMessage({ conversationId, senderId, body = "", mediaIds = [] }) {
  const trimmedBody = body.trim();
  const uniqueMediaIds = [...new Set(mediaIds.map(Number))];
  if (uniqueMediaIds.length !== mediaIds.length
      || uniqueMediaIds.length > 4
      || uniqueMediaIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw messageRuleError("Choose up to four valid photos.");
  }
  if (!trimmedBody && !uniqueMediaIds.length) {
    throw messageRuleError("A message or photo is required.");
  }

  return withTransaction(async (client) => {
    const { rows: [message] } = await client.query(
      `WITH inserted AS (
         INSERT INTO direct_messages (conversation_id, sender_id, body)
         SELECT conversation_id, $2, $3
         FROM direct_conversations
         WHERE conversation_id = $1
           AND (user_one_id = $2 OR user_two_id = $2)
         RETURNING *
       )
       SELECT inserted.*, member.username AS sender_username,
         member.avatar_url AS sender_avatar_url
       FROM inserted
       JOIN users member ON member.user_id = inserted.sender_id`,
      [conversationId, senderId, trimmedBody]
    );
    if (!message) throw messageRuleError("Conversation not found.", 404);

    let images = [];
    if (uniqueMediaIds.length) {
      const { rows: media } = await client.query(
        `SELECT asset.media_id, asset.format, asset.byte_size, asset.width, asset.height,
                selected.display_order
         FROM unnest($1::BIGINT[]) WITH ORDINALITY AS selected(media_id, display_order)
         JOIN media_assets asset ON asset.media_id = selected.media_id
         WHERE asset.uploaded_by = $2 AND asset.status = 'pending'
         ORDER BY selected.display_order
         FOR UPDATE OF asset`,
        [uniqueMediaIds, senderId]
      );
      if (media.length !== uniqueMediaIds.length) {
        throw messageRuleError("One or more photos are unavailable. Remove them and try again.");
      }

      await client.query(
        `INSERT INTO direct_message_images (message_id, media_id, display_order)
         SELECT $1, media_id, display_order - 1
         FROM unnest($2::BIGINT[]) WITH ORDINALITY AS selected(media_id, display_order)`,
        [message.message_id, uniqueMediaIds]
      );
      await client.query(
        `UPDATE media_assets
         SET status = 'attached', attached_at = NOW()
         WHERE media_id = ANY($1::BIGINT[])`,
        [uniqueMediaIds]
      );
      images = media.map(({ display_order, ...asset }) => ({
        ...asset,
        display_order: Number(display_order) - 1,
      }));
    }

    return { ...message, images };
  });
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
