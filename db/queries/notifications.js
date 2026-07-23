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
        p.title AS post_title
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
