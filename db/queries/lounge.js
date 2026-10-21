import db from "#db/client";
import { publicPostSql } from "#utils/forumAccess";

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

export async function getCommunityPulse() {
  // Community-facing summaries use only member-visible activity, even for staff.
  const publicActivity = `public_posts AS (SELECT p.* FROM posts p WHERE ${publicPostSql("p")}),
    public_comments AS (SELECT c.* FROM comments c JOIN public_posts p ON p.post_id = c.post_id),
    public_reactions AS (SELECT r.* FROM forum_reactions r LEFT JOIN comments c ON c.comment_id = r.comment_id
      JOIN public_posts p ON p.post_id = COALESCE(r.post_id, c.post_id))`;
  const [summaryResult, weekResult, activityResult] = await Promise.all([
    db.query(`
      WITH ${publicActivity}, today_activity AS (
        SELECT author_id AS user_id, 'post' AS kind
        FROM public_posts
        WHERE active = TRUE AND deleted_at IS NULL AND created_at >= CURRENT_DATE
        UNION ALL
        SELECT author_id, 'reply'
        FROM public_comments
        WHERE active = TRUE AND deleted_at IS NULL AND created_at >= CURRENT_DATE
        UNION ALL
        SELECT user_id, 'reaction'
        FROM public_reactions
        WHERE created_at >= CURRENT_DATE
      )
      SELECT
        COUNT(*) FILTER (WHERE kind = 'post')::INT AS posts_today,
        COUNT(*) FILTER (WHERE kind = 'reply')::INT AS replies_today,
        COUNT(*) FILTER (WHERE kind = 'reaction')::INT AS reactions_today,
        COUNT(DISTINCT user_id)::INT AS participants_today
      FROM today_activity
    `),
    db.query(`
      WITH ${publicActivity}, days AS (
        SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::DATE AS day
      ), activity AS (
        SELECT created_at::DATE AS day, 'post' AS kind
        FROM public_posts WHERE active = TRUE AND deleted_at IS NULL AND created_at >= CURRENT_DATE - INTERVAL '6 days'
        UNION ALL
        SELECT created_at::DATE, 'reply'
        FROM public_comments WHERE active = TRUE AND deleted_at IS NULL AND created_at >= CURRENT_DATE - INTERVAL '6 days'
        UNION ALL
        SELECT created_at::DATE, 'reaction'
        FROM public_reactions WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
      )
      SELECT days.day,
        COUNT(activity.kind) FILTER (WHERE activity.kind = 'post')::INT AS posts,
        COUNT(activity.kind) FILTER (WHERE activity.kind = 'reply')::INT AS replies,
        COUNT(activity.kind) FILTER (WHERE activity.kind = 'reaction')::INT AS reactions,
        COUNT(activity.kind)::INT AS total
      FROM days
      LEFT JOIN activity ON activity.day = days.day
      GROUP BY days.day
      ORDER BY days.day
    `),
    db.query(`
      WITH ${publicActivity}, recent_activity AS (
        SELECT p.created_at, 'post' AS activity_type, p.author_id AS actor_id,
          p.post_id, p.title
        FROM public_posts p
        WHERE p.active = TRUE AND p.deleted_at IS NULL
        UNION ALL
        SELECT c.created_at, 'reply', c.author_id, p.post_id, p.title
        FROM public_comments c
        JOIN public_posts p ON p.post_id = c.post_id
        WHERE c.active = TRUE AND c.deleted_at IS NULL
          AND p.active = TRUE AND p.deleted_at IS NULL
        UNION ALL
        SELECT reaction.created_at, 'reaction', reaction.user_id,
          p.post_id, p.title
        FROM public_reactions reaction
        LEFT JOIN public_comments c ON c.comment_id = reaction.comment_id
        JOIN public_posts p ON p.post_id = COALESCE(reaction.post_id, c.post_id)
        WHERE p.active = TRUE AND p.deleted_at IS NULL
      )
      SELECT activity.activity_type, activity.actor_id, activity.post_id,
        activity.title, activity.created_at,
        CASE WHEN activity.activity_type = 'post' AND p.is_imported
          THEN p.imported_author_label ELSE users.username END AS username,
        CASE WHEN activity.activity_type = 'post' AND p.is_imported THEN NULL ELSE users.avatar_url END AS avatar_url
      FROM recent_activity activity
      JOIN users ON users.user_id = activity.actor_id
      JOIN posts p ON p.post_id = activity.post_id
      WHERE users.active = TRUE AND users.deleted_at IS NULL AND users.is_system = FALSE
      ORDER BY activity.created_at DESC
      LIMIT 10
    `),
  ]);

  return {
    summary: summaryResult.rows[0],
    week: weekResult.rows,
    activity: activityResult.rows,
  };
}

export async function getLoungeMessages({ beforeId = null, limit = 50, roomSlug = ROOM_SLUG }) {
  const values = [roomSlug];
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

export async function createLoungeMessage({ authorId, authorUsername, body, roomSlug = ROOM_SLUG }) {
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
    [roomSlug, authorId, authorUsername, body]
  );
  return message;
}

export async function markLoungeRead(userId, roomSlug = ROOM_SLUG) {
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
    [roomSlug, userId]
  );
}

export async function getLoungeUnreadCount(userId, roomSlug = ROOM_SLUG) {
  const { rows: [{ unread_count }] } = await db.query(
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
    [roomSlug, userId]
  );
  return unread_count;
}

export async function softDeleteLoungeMessage({ messageId, actingUserId, canModerate, roomSlug = ROOM_SLUG }) {
  const { rows: [message] } = await db.query(
    `
      UPDATE lounge_messages
      SET deleted_at = NOW(), deleted_by = $2
      WHERE message_id = $1
        AND room_id = (SELECT room_id FROM lounge_rooms WHERE slug = $4 AND active = TRUE)
        AND deleted_at IS NULL
        AND (author_id = $2 OR $3 = TRUE)
      RETURNING message_id, deleted_at
    `,
    [messageId, actingUserId, canModerate, roomSlug]
  );
  return message;
}
