import db from "#db/client";

const ROOM_SLUG = "community-lounge";

export async function getLoungeStatus(userId) {
  const [activityResult, unreadResult, peopleResult] = await Promise.all([
    db.query(
      `
        SELECT
          MAX(lm.created_at) FILTER (WHERE lm.deleted_at IS NULL) AS last_message_at,
          COUNT(*) FILTER (
            WHERE lm.deleted_at IS NULL AND lm.created_at >= NOW() - INTERVAL '1 hour'
          )::INT AS messages_last_hour,
          COUNT(DISTINCT lm.author_id) FILTER (
            WHERE lm.deleted_at IS NULL AND lm.created_at >= CURRENT_DATE
          )::INT AS participants_today
        FROM lounge_rooms lr
        LEFT JOIN lounge_messages lm ON lm.room_id = lr.room_id
        WHERE lr.slug = $1 AND lr.active = TRUE
      `,
      [ROOM_SLUG]
    ),
    db.query(
      `
        SELECT COUNT(*)::INT AS unread_count
        FROM lounge_messages lm
        JOIN lounge_rooms lr ON lr.room_id = lm.room_id
        LEFT JOIN lounge_reads read
          ON read.room_id = lr.room_id AND read.user_id = $2
        WHERE lr.slug = $1
          AND lm.deleted_at IS NULL
          AND lm.author_id IS DISTINCT FROM $2
          AND lm.message_id > COALESCE(read.last_read_message_id, 0)
      `,
      [ROOM_SLUG, userId]
    ),
    db.query(
      `
        SELECT DISTINCT ON (lm.author_id)
          lm.author_id AS user_id, lm.author_username AS username, u.avatar_url,
          lm.created_at
        FROM lounge_messages lm
        JOIN lounge_rooms lr ON lr.room_id = lm.room_id
        LEFT JOIN users u ON u.user_id = lm.author_id
        WHERE lr.slug = $1 AND lm.deleted_at IS NULL AND lm.author_id IS NOT NULL
        ORDER BY lm.author_id, lm.created_at DESC
      `,
      [ROOM_SLUG]
    ),
  ]);

  const recentPeople = peopleResult.rows
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3)
    .map(({ created_at, ...person }) => person);

  return {
    ...activityResult.rows[0],
    unread_count: unreadResult.rows[0].unread_count,
    recent_people: recentPeople,
  };
}

export async function getLoungeMessages({ beforeId = null, limit = 50 }) {
  const values = [ROOM_SLUG];
  const before = beforeId ? "AND lm.message_id < $2" : "";
  if (beforeId) values.push(beforeId);
  values.push(limit + 1);

  const { rows } = await db.query(
    `
      SELECT lm.message_id, lm.author_id, lm.author_username, u.avatar_url,
             CASE WHEN lm.deleted_at IS NULL THEN lm.body ELSE NULL END AS body,
             lm.created_at, lm.deleted_at
      FROM lounge_messages lm
      JOIN lounge_rooms lr ON lr.room_id = lm.room_id
      LEFT JOIN users u ON u.user_id = lm.author_id
      WHERE lr.slug = $1 AND lr.active = TRUE ${before}
      ORDER BY lm.message_id DESC
      LIMIT $${values.length}
    `,
    values
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    messages: page.reverse(),
    hasMore,
    nextCursor: hasMore ? page[0].message_id : null,
  };
}

export async function createLoungeMessage({ authorId, authorUsername, body }) {
  const { rows: [message] } = await db.query(
    `
      WITH inserted AS (
        INSERT INTO lounge_messages (room_id, author_id, author_username, body)
        SELECT room_id, $2, $3, $4
        FROM lounge_rooms
        WHERE slug = $1 AND active = TRUE
        RETURNING *
      )
      SELECT inserted.message_id, inserted.author_id, inserted.author_username,
             u.avatar_url, inserted.body, inserted.created_at, inserted.deleted_at
      FROM inserted
      LEFT JOIN users u ON u.user_id = inserted.author_id
    `,
    [ROOM_SLUG, authorId, authorUsername, body]
  );
  return message;
}

export async function markLoungeRead(userId) {
  await db.query(
    `
      INSERT INTO lounge_reads (room_id, user_id, last_read_message_id)
      SELECT lr.room_id, $2, MAX(lm.message_id)
      FROM lounge_rooms lr
      LEFT JOIN lounge_messages lm ON lm.room_id = lr.room_id
      WHERE lr.slug = $1
      GROUP BY lr.room_id
      ON CONFLICT (room_id, user_id) DO UPDATE
        SET last_read_message_id = EXCLUDED.last_read_message_id,
            updated_at = NOW()
    `,
    [ROOM_SLUG, userId]
  );
}

export async function softDeleteLoungeMessage({ messageId, actingUserId, canModerate }) {
  const { rows: [message] } = await db.query(
    `
      UPDATE lounge_messages
      SET deleted_at = NOW(), deleted_by = $2
      WHERE message_id = $1
        AND deleted_at IS NULL
        AND (author_id = $2 OR $3 = TRUE)
      RETURNING message_id, deleted_at
    `,
    [messageId, actingUserId, canModerate]
  );
  return message;
}
