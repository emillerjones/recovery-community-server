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

export async function createStaffFlagNotifications({ actorId, postId, commentId = null }) {
  // FLAG ALERT TRACE STEP 3: insert one durable alert for every active owner,
  // administrator, and moderator. The flagging person is excluded if they are
  // staff, and ordinary members/content authors never enter this recipient set.
  const type = commentId ? "flagged_comment" : "flagged_post";
  const { rows } = await db.query(
    `
      WITH inserted AS (
        INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
        SELECT staff.user_id, $1, $2, $3, $4
        FROM users staff
        WHERE staff.role_id <= 50
          AND staff.account_status = 'approved'
          AND staff.active = TRUE
          AND staff.deleted_at IS NULL
          AND staff.is_system = FALSE
          AND staff.user_id <> $1
        RETURNING *
      )
      SELECT inserted.*, actor.username AS actor_username, p.title AS post_title
      FROM inserted
      JOIN users actor ON actor.user_id = inserted.actor_id
      JOIN posts p ON p.post_id = inserted.post_id
      ORDER BY inserted.notification_id
    `,
    [actorId, type, postId, commentId]
  );
  return rows;
}

export async function createPendingApplicationNotifications(applicantId) {
  // Membership review is limited to owners and administrators. Moderators can
  // handle forum reports, but they cannot open or decide private applications.
  const { rows } = await db.query(
    `
      WITH inserted AS (
        INSERT INTO notifications (user_id, actor_id, type)
        SELECT staff.user_id, $1, 'pending_membership_application'
        FROM users staff
        WHERE staff.role_id <= 10
          AND staff.account_status = 'approved'
          AND staff.active = TRUE
          AND staff.deleted_at IS NULL
          AND staff.is_system = FALSE
        RETURNING *
      )
      SELECT inserted.*, applicant.username AS actor_username, NULL::TEXT AS post_title
      FROM inserted
      JOIN users applicant ON applicant.user_id = inserted.actor_id
      ORDER BY inserted.notification_id
    `,
    [applicantId]
  );
  return rows;
}

export async function createForumParticipantNotifications({ actorId, postId, commentId = null, activity }) {
  // The owner-approved participant group is deliberately narrow: the OG
  // poster, original-post reactors, and direct commenters only. Replies below
  // another comment are targeted conversations and do not join this group.
  const type = activity === "reaction"
    ? "reaction_on_participated_post"
    : "comment_on_participated_post";
  const { rows } = await db.query(
    `
      WITH participant_ids AS (
        SELECT author_id AS user_id FROM posts WHERE post_id = $2
        UNION
        SELECT user_id FROM forum_reactions WHERE post_id = $2
        UNION
        SELECT author_id AS user_id
        FROM comments
        WHERE post_id = $2
          AND parent_comment_id IS NULL
          AND active = TRUE
          AND deleted_at IS NULL
      ), eligible_recipients AS (
        SELECT participant.user_id
        FROM participant_ids participant
        JOIN users recipient ON recipient.user_id = participant.user_id
        WHERE participant.user_id <> $1
          AND recipient.account_status = 'approved'
          AND recipient.active = TRUE
          AND recipient.deleted_at IS NULL
          AND recipient.is_system = FALSE
      ), inserted AS (
        INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
        SELECT user_id, $1, $3, $2, $4
        FROM eligible_recipients
        RETURNING *
      )
      SELECT inserted.*, actor.username AS actor_username, p.title AS post_title
      FROM inserted
      JOIN users actor ON actor.user_id = inserted.actor_id
      JOIN posts p ON p.post_id = inserted.post_id
      ORDER BY inserted.notification_id
    `,
    [actorId, postId, type, commentId]
  );
  return rows;
}

export async function createDirectReplyNotification({ actorId, postId, parentCommentId, commentId }) {
  // A nested reply is one-to-one: notify only the author of the exact comment
  // being replied to. Confirm that parent belongs to this post and that its
  // author is still eligible before inserting the permanent notification.
  const { rows: [notification] } = await db.query(
    `
      WITH recipient AS (
        SELECT parent.author_id AS user_id
        FROM comments parent
        JOIN users author ON author.user_id = parent.author_id
        WHERE parent.comment_id = $3
          AND parent.post_id = $2
          AND parent.deleted_at IS NULL
          AND parent.author_id <> $1
          AND author.account_status = 'approved'
          AND author.active = TRUE
          AND author.deleted_at IS NULL
          AND author.is_system = FALSE
      ), inserted AS (
        INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
        SELECT user_id, $1, 'reply_to_comment', $2, $4
        FROM recipient
        RETURNING *
      )
      SELECT inserted.*, actor.username AS actor_username, p.title AS post_title
      FROM inserted
      JOIN users actor ON actor.user_id = inserted.actor_id
      JOIN posts p ON p.post_id = inserted.post_id
    `,
    [actorId, postId, parentCommentId, commentId]
  );
  return notification;
}

export async function createForumFollowerNotifications({
  actorId,
  postId,
  commentId,
  skipUserIds = [],
}) {
  // Following is an intentional notification choice, separate from the
  // owner-defined participant group. Exclude recipients already notified by
  // participant/reply rules so one new reply creates only one alert per user.
  const { rows } = await db.query(
    `
      WITH eligible_recipients AS (
        SELECT followed.user_id
        FROM forum_saved_posts followed
        JOIN users recipient ON recipient.user_id = followed.user_id
        WHERE followed.post_id = $2
          AND followed.user_id <> $1
          AND NOT (followed.user_id = ANY($4::INT[]))
          AND recipient.account_status = 'approved'
          AND recipient.active = TRUE
          AND recipient.deleted_at IS NULL
          AND recipient.is_system = FALSE
      ), inserted AS (
        INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
        SELECT user_id, $1, 'comment_on_followed_post', $2, $3
        FROM eligible_recipients
        RETURNING *
      )
      SELECT inserted.*, actor.username AS actor_username, p.title AS post_title
      FROM inserted
      JOIN users actor ON actor.user_id = inserted.actor_id
      JOIN posts p ON p.post_id = inserted.post_id
      ORDER BY inserted.notification_id
    `,
    [actorId, postId, commentId, skipUserIds]
  );
  return rows;
}

export async function getNewPostNotifications(postId) {
  // NEW POST ALERT TRACE STEP 3: the database trigger has already inserted one
  // durable row per eligible member. Return those fresh rows with the display
  // information the notification bell expects for its real-time update.
  const { rows } = await db.query(
    `
      SELECT n.*, actor.username AS actor_username, p.title AS post_title
      FROM notifications n
      JOIN users actor ON actor.user_id = n.actor_id
      JOIN posts p ON p.post_id = n.post_id
      WHERE n.post_id = $1 AND n.type = 'new_forum_post'
      ORDER BY n.notification_id
    `,
    [postId]
  );
  return rows;
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
