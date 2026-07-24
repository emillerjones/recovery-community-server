import db from "#db/client";

export async function createNotification({ userId, actorId, type, postId, commentId }) {
  const {
    rows: [notification],
  } = await db.query(
    `
      WITH inserted AS (
        INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      )
      SELECT
        inserted.*,
        users.username AS actor_username,
        posts.title AS post_title
      FROM inserted
      JOIN users ON users.user_id = inserted.actor_id
      LEFT JOIN posts ON posts.post_id = inserted.post_id
    `,
    [userId, actorId, type, postId, commentId]
  );
  return notification;
}

export async function getNotifications(userId, limit = 30) {
  const { rows } = await db.query(
    `
      SELECT
        n.*,
        u.username AS actor_username,
        p.title AS post_title,
        CASE
          WHEN n.type = 'reaction_to_post' THEN (
            SELECT COUNT(*)::INT FROM forum_reactions r WHERE r.post_id = n.post_id
          )
          WHEN n.type = 'reaction_to_comment' THEN (
            SELECT COUNT(*)::INT FROM forum_reactions r WHERE r.comment_id = n.comment_id
          )
          ELSE NULL
        END AS reaction_count
      FROM notifications n
      JOIN users u ON u.user_id = n.actor_id
      LEFT JOIN posts p ON p.post_id = n.post_id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );
  return rows;
}

// Keep one unread notification per reacted-to post/reply. More reactions update
// that row instead of filling the recipient's bell with nearly identical alerts.
export async function createOrGroupReactionNotification({ userId, actorId, postId, commentId }) {
  const type = commentId ? "reaction_to_comment" : "reaction_to_post";
  const { rows: [notification] } = await db.query(
    `
      WITH existing AS (
        SELECT notification_id
        FROM notifications
        WHERE user_id = $1
          AND type = $3
          AND post_id = $4
          AND comment_id IS NOT DISTINCT FROM $5
          AND read_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      ), updated AS (
        UPDATE notifications n
        SET actor_id = $2, created_at = NOW()
        FROM existing e
        WHERE n.notification_id = e.notification_id
        RETURNING n.*, TRUE AS grouped
      ), inserted AS (
        INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
        SELECT $1, $2, $3, $4, $5
        WHERE NOT EXISTS (SELECT 1 FROM updated)
        RETURNING *, FALSE AS grouped
      )
      SELECT result.*, u.username AS actor_username, p.title AS post_title,
        CASE
          WHEN result.type = 'reaction_to_post' THEN
            (SELECT COUNT(*)::INT FROM forum_reactions r WHERE r.post_id = result.post_id)
          ELSE
            (SELECT COUNT(*)::INT FROM forum_reactions r WHERE r.comment_id = result.comment_id)
        END AS reaction_count
      FROM (SELECT * FROM updated UNION ALL SELECT * FROM inserted) result
      JOIN users u ON u.user_id = result.actor_id
      JOIN posts p ON p.post_id = result.post_id
    `,
    [userId, actorId, type, postId, commentId || null]
  );
  return notification;
}

export async function getUnreadNotificationCount(userId) {
  const {
    rows: [{ count }],
  } = await db.query(
    `SELECT COUNT(*)::INT AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return count;
}

export async function markNotificationRead(notificationId, userId) {
  const {
    rows: [notification],
  } = await db.query(
    `
      UPDATE notifications
      SET read_at = COALESCE(read_at, NOW())
      WHERE notification_id = $1 AND user_id = $2
      RETURNING *
    `,
    [notificationId, userId]
  );
  return notification;
}

export async function markAllNotificationsRead(userId) {
  await db.query(
    `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
}
