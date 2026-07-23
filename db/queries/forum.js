import db from "#db/client";

export async function getForumCategories() {
  const { rows } = await db.query(`
    SELECT
      c.*,
      COUNT(p.post_id)::INT AS post_count,
      MAX(p.created_at) AS latest_post_at
    FROM forum_categories c
    LEFT JOIN posts p
      ON p.category_id = c.category_id
      AND p.active = TRUE
      AND p.deleted_at IS NULL
    WHERE c.active = TRUE
    GROUP BY c.category_id
    ORDER BY c.sort_order, c.name
  `);
  return rows;
}

export async function getForumPosts({ categorySlug, search, viewerId } = {}) {
  const values = [viewerId ?? null];
  let categoryFilter = "";
  let searchFilter = "";

  if (categorySlug) {
    values.push(categorySlug);
    categoryFilter = `AND c.slug = $${values.length}`;
  }

  if (search) {
    values.push(`%${search}%`);
    searchFilter = `AND (p.title ILIKE $${values.length} OR p.body ILIKE $${values.length})`;
  }

  const { rows } = await db.query(
    `
      SELECT
        p.post_id,
        p.title,
        p.body,
        p.pinned,
        p.locked,
        p.created_at,
        p.updated_at,
        c.category_id,
        c.name AS category_name,
        c.slug AS category_slug,
        u.user_id AS author_id,
        u.username AS author_username,
        u.avatar_url AS author_avatar_url,
        COUNT(cm.comment_id)::INT AS comment_count,
        GREATEST(p.updated_at, COALESCE(MAX(cm.created_at), p.updated_at)) AS latest_activity_at,
        EXISTS(
          SELECT 1 FROM forum_saved_posts sp
          WHERE sp.post_id = p.post_id AND sp.user_id = $1
        ) AS saved_by_me
      FROM posts p
      JOIN forum_categories c ON c.category_id = p.category_id
      JOIN users u ON u.user_id = p.author_id
      LEFT JOIN comments cm
        ON cm.post_id = p.post_id
        AND cm.active = TRUE
        AND cm.deleted_at IS NULL
      WHERE p.active = TRUE
        AND p.deleted_at IS NULL
        AND c.active = TRUE
        ${categoryFilter}
        ${searchFilter}
      GROUP BY p.post_id, c.category_id, u.user_id
      ORDER BY p.pinned DESC, latest_activity_at DESC
    `,
    values
  );
  return rows;
}

export async function getForumPostById(postId, viewerId) {
  const {
    rows: [post],
  } = await db.query(
    `
      SELECT
        p.*,
        c.name AS category_name,
        c.slug AS category_slug,
        u.username AS author_username,
        u.avatar_url AS author_avatar_url,
        EXISTS(
          SELECT 1 FROM forum_content_flags flags
          WHERE flags.post_id = p.post_id
            AND flags.flagged_by = $2
            AND flags.reviewed_at IS NULL
        ) AS flagged_by_me,
        EXISTS(
          SELECT 1 FROM forum_saved_posts sp
          WHERE sp.post_id = p.post_id AND sp.user_id = $2
        ) AS saved_by_me
      FROM posts p
      JOIN forum_categories c ON c.category_id = p.category_id
      JOIN users u ON u.user_id = p.author_id
      WHERE p.post_id = $1
        AND p.active = TRUE
        AND p.deleted_at IS NULL
    `,
    [postId, viewerId]
  );
  return post;
}

export async function getForumComments(postId, viewerId) {
  const { rows } = await db.query(
    `
      SELECT
        cm.comment_id,
        cm.post_id,
        cm.parent_comment_id,
        cm.author_id,
        cm.created_at,
        cm.updated_at,
        cm.deleted_at,
        CASE WHEN cm.deleted_at IS NULL THEN cm.body ELSE NULL END AS body,
        CASE WHEN cm.deleted_at IS NULL THEN u.username ELSE NULL END AS author_username,
        CASE WHEN cm.deleted_at IS NULL THEN u.avatar_url ELSE NULL END AS author_avatar_url,
        EXISTS(
          SELECT 1 FROM forum_content_flags flags
          WHERE flags.comment_id = cm.comment_id
            AND flags.flagged_by = $2
            AND flags.reviewed_at IS NULL
        ) AS flagged_by_me
      FROM comments cm
      JOIN users u ON u.user_id = cm.author_id
      WHERE cm.post_id = $1
      ORDER BY cm.created_at
    `,
    [postId, viewerId]
  );
  return rows;
}

export async function createForumPost({ categoryId, authorId, title, body }) {
  const {
    rows: [post],
  } = await db.query(
    `
      INSERT INTO posts (category_id, author_id, title, body)
      SELECT category_id, $2, $3, $4
      FROM forum_categories
      WHERE category_id = $1 AND active = TRUE
      RETURNING *
    `,
    [categoryId, authorId, title.trim(), body.trim()]
  );
  return post;
}

export async function createForumComment({ postId, authorId, parentCommentId, body }) {
  const {
    rows: [comment],
  } = await db.query(
    `
      WITH inserted AS (
        INSERT INTO comments (post_id, author_id, parent_comment_id, body)
        SELECT p.post_id, $2, $3, $4
        FROM posts p
        WHERE p.post_id = $1
          AND p.active = TRUE
          AND p.deleted_at IS NULL
          AND p.locked = FALSE
        RETURNING *
      )
      SELECT
        inserted.*,
        u.username AS author_username,
        u.avatar_url AS author_avatar_url,
        FALSE AS flagged_by_me
      FROM inserted
      JOIN users u ON u.user_id = inserted.author_id
    `,
    [postId, authorId, parentCommentId, body.trim()]
  );
  return comment;
}

export async function getForumNotificationRecipient(postId, parentCommentId) {
  if (parentCommentId) {
    const {
      rows: [comment],
    } = await db.query(`SELECT author_id FROM comments WHERE comment_id = $1`, [parentCommentId]);
    return comment?.author_id ?? null;
  }

  const {
    rows: [post],
  } = await db.query(`SELECT author_id FROM posts WHERE post_id = $1`, [postId]);
  return post?.author_id ?? null;
}

export async function updateForumPostModeration(postId, { pinned, locked }) {
  const fields = [];
  const values = [];

  if (typeof pinned === "boolean") {
    values.push(pinned);
    fields.push(`pinned = $${values.length}`);
  }
  if (typeof locked === "boolean") {
    values.push(locked);
    fields.push(`locked = $${values.length}`);
  }
  if (!fields.length) return null;

  values.push(postId);
  const {
    rows: [post],
  } = await db.query(
    `
      UPDATE posts
      SET ${fields.join(", ")}, updated_at = NOW()
      WHERE post_id = $${values.length}
        AND deleted_at IS NULL
      RETURNING *
    `,
    values
  );
  return post;
}

export async function updateForumPost(postId, authorId, { title, body }) {
  const fields = [];
  const values = [];

  if (title) {
    values.push(title.trim());
    fields.push(`title = $${values.length}`);
  }
  if (body) {
    values.push(body.trim());
    fields.push(`body = $${values.length}`);
  }
  if (!fields.length) return null;

  values.push(postId, authorId);
  const {
    rows: [post],
  } = await db.query(
    `
      UPDATE posts
      SET ${fields.join(", ")}, updated_at = NOW()
      WHERE post_id = $${values.length - 1}
        AND author_id = $${values.length}
        AND deleted_at IS NULL
        AND locked = FALSE
      RETURNING *
    `,
    values
  );
  return post;
}

export async function softDeleteForumPost(postId, authorId, isModerator = false) {
  const {
    rows: [post],
  } = await db.query(
    `
      UPDATE posts
      SET active = FALSE, deleted_at = NOW(), updated_at = NOW()
      WHERE post_id = $1
        AND deleted_at IS NULL
        AND (author_id = $2 OR $3)
      RETURNING *
    `,
    [postId, authorId, isModerator]
  );
  return post;
}

export async function softDeleteForumComment(commentId, authorId, isModerator = false) {
  const {
    rows: [comment],
  } = await db.query(
    `
      UPDATE comments
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE comment_id = $1
        AND deleted_at IS NULL
        AND (author_id = $2 OR $3)
      RETURNING *
    `,
    [commentId, authorId, isModerator]
  );
  return comment;
}

export async function flagForumPost(postId, flaggedBy, reason) {
  const {
    rows: [flag],
  } = await db.query(
    `
      INSERT INTO forum_content_flags (post_id, flagged_by, reason)
      SELECT post_id, $2, $3
      FROM posts
      WHERE post_id = $1
        AND author_id <> $2
        AND deleted_at IS NULL
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [postId, flaggedBy, reason || null]
  );
  return flag || null;
}

export async function unflagForumPost(postId, flaggedBy) {
  const {
    rows: [flag],
  } = await db.query(
    `
      DELETE FROM forum_content_flags
      WHERE post_id = $1
        AND flagged_by = $2
        AND reviewed_at IS NULL
      RETURNING *
    `,
    [postId, flaggedBy]
  );
  return flag || null;
}

export async function flagForumComment(commentId, flaggedBy, reason) {
  const {
    rows: [flag],
  } = await db.query(
    `
      INSERT INTO forum_content_flags (comment_id, flagged_by, reason)
      SELECT comment_id, $2, $3
      FROM comments
      WHERE comment_id = $1
        AND author_id <> $2
        AND deleted_at IS NULL
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [commentId, flaggedBy, reason || null]
  );
  return flag || null;
}

export async function unflagForumComment(commentId, flaggedBy) {
  const {
    rows: [flag],
  } = await db.query(
    `
      DELETE FROM forum_content_flags
      WHERE comment_id = $1
        AND flagged_by = $2
        AND reviewed_at IS NULL
      RETURNING *
    `,
    [commentId, flaggedBy]
  );
  return flag || null;
}

export async function getFlaggedForumPosts() {
  const { rows } = await db.query(`
    SELECT
      p.post_id,
      p.title,
      p.body,
      p.author_id,
      u.username AS author_username,
      COUNT(flags.flag_id)::INT AS flag_count,
      MAX(flags.created_at) AS last_flagged_at
    FROM forum_content_flags flags
    JOIN posts p ON p.post_id = flags.post_id
    JOIN users u ON u.user_id = p.author_id
    WHERE flags.post_id IS NOT NULL
      AND flags.reviewed_at IS NULL
    GROUP BY p.post_id, u.username
    ORDER BY flag_count DESC, last_flagged_at DESC
  `);
  return rows;
}

export async function getFlaggedForumComments() {
  const { rows } = await db.query(`
    SELECT
      cm.comment_id,
      cm.post_id,
      cm.body,
      cm.author_id,
      u.username AS author_username,
      COUNT(flags.flag_id)::INT AS flag_count,
      MAX(flags.created_at) AS last_flagged_at
    FROM forum_content_flags flags
    JOIN comments cm ON cm.comment_id = flags.comment_id
    JOIN users u ON u.user_id = cm.author_id
    WHERE flags.comment_id IS NOT NULL
      AND flags.reviewed_at IS NULL
    GROUP BY cm.comment_id, u.username
    ORDER BY flag_count DESC, last_flagged_at DESC
  `);
  return rows;
}

export async function reviewForumPostFlags(postId, reviewedBy) {
  const { rowCount } = await db.query(
    `
      UPDATE forum_content_flags
      SET reviewed_at = NOW(), reviewed_by = $2
      WHERE post_id = $1 AND reviewed_at IS NULL
    `,
    [postId, reviewedBy]
  );
  return rowCount;
}

export async function reviewForumCommentFlags(commentId, reviewedBy) {
  const { rowCount } = await db.query(
    `
      UPDATE forum_content_flags
      SET reviewed_at = NOW(), reviewed_by = $2
      WHERE comment_id = $1 AND reviewed_at IS NULL
    `,
    [commentId, reviewedBy]
  );
  return rowCount;
}

export async function saveForumPost(postId, userId) {
  await db.query(
    `
      INSERT INTO forum_saved_posts (user_id, post_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `,
    [userId, postId]
  );
}

export async function unsaveForumPost(postId, userId) {
  await db.query(
    `DELETE FROM forum_saved_posts WHERE user_id = $1 AND post_id = $2`,
    [userId, postId]
  );
}
