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

export async function getForumPosts({ categorySlug, search } = {}) {
  const values = [];
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
        GREATEST(p.updated_at, COALESCE(MAX(cm.created_at), p.updated_at)) AS latest_activity_at
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
          SELECT 1 FROM forum_post_reports fpr
          WHERE fpr.post_id = p.post_id
            AND fpr.reporter_id = $2
            AND fpr.resolved_at IS NULL
        ) AS reported_by_me
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
          SELECT 1 FROM forum_comment_reports fcr
          WHERE fcr.comment_id = cm.comment_id
            AND fcr.reporter_id = $2
            AND fcr.resolved_at IS NULL
        ) AS reported_by_me
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
      INSERT INTO comments (post_id, author_id, parent_comment_id, body)
      SELECT p.post_id, $2, $3, $4
      FROM posts p
      WHERE p.post_id = $1
        AND p.active = TRUE
        AND p.deleted_at IS NULL
        AND p.locked = FALSE
      RETURNING *
    `,
    [postId, authorId, parentCommentId, body.trim()]
  );
  return comment;
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

export async function reportForumPost(postId, reporterId, reason) {
  const {
    rows: [report],
  } = await db.query(
    `
      INSERT INTO forum_post_reports (post_id, reporter_id, reason)
      VALUES ($1, $2, $3)
      ON CONFLICT (post_id, reporter_id) DO NOTHING
      RETURNING *
    `,
    [postId, reporterId, reason || null]
  );
  return report || null;
}

export async function unreportForumPost(postId, reporterId) {
  const {
    rows: [report],
  } = await db.query(
    `
      DELETE FROM forum_post_reports
      WHERE post_id = $1 AND reporter_id = $2
      RETURNING *
    `,
    [postId, reporterId]
  );
  return report || null;
}

export async function reportForumComment(commentId, reporterId, reason) {
  const {
    rows: [report],
  } = await db.query(
    `
      INSERT INTO forum_comment_reports (comment_id, reporter_id, reason)
      VALUES ($1, $2, $3)
      ON CONFLICT (comment_id, reporter_id) DO NOTHING
      RETURNING *
    `,
    [commentId, reporterId, reason || null]
  );
  return report || null;
}

export async function unreportForumComment(commentId, reporterId) {
  const {
    rows: [report],
  } = await db.query(
    `
      DELETE FROM forum_comment_reports
      WHERE comment_id = $1 AND reporter_id = $2
      RETURNING *
    `,
    [commentId, reporterId]
  );
  return report || null;
}

export async function getReportedForumPosts() {
  const { rows } = await db.query(`
    SELECT
      p.post_id,
      p.title,
      p.body,
      p.author_id,
      u.username AS author_username,
      COUNT(fpr.report_id)::INT AS report_count,
      MAX(fpr.created_at) AS last_reported_at
    FROM forum_post_reports fpr
    JOIN posts p ON p.post_id = fpr.post_id
    JOIN users u ON u.user_id = p.author_id
    WHERE fpr.resolved_at IS NULL
    GROUP BY p.post_id, u.username
    ORDER BY report_count DESC, last_reported_at DESC
  `);
  return rows;
}

export async function getReportedForumComments() {
  const { rows } = await db.query(`
    SELECT
      cm.comment_id,
      cm.post_id,
      cm.body,
      cm.author_id,
      u.username AS author_username,
      COUNT(fcr.report_id)::INT AS report_count,
      MAX(fcr.created_at) AS last_reported_at
    FROM forum_comment_reports fcr
    JOIN comments cm ON cm.comment_id = fcr.comment_id
    JOIN users u ON u.user_id = cm.author_id
    WHERE fcr.resolved_at IS NULL
    GROUP BY cm.comment_id, u.username
    ORDER BY report_count DESC, last_reported_at DESC
  `);
  return rows;
}

export async function resolveForumPostReports(postId, resolvedBy) {
  const { rowCount } = await db.query(
    `
      UPDATE forum_post_reports
      SET resolved_at = NOW(), resolved_by = $2
      WHERE post_id = $1 AND resolved_at IS NULL
    `,
    [postId, resolvedBy]
  );
  return rowCount;
}

export async function resolveForumCommentReports(commentId, resolvedBy) {
  const { rowCount } = await db.query(
    `
      UPDATE forum_comment_reports
      SET resolved_at = NOW(), resolved_by = $2
      WHERE comment_id = $1 AND resolved_at IS NULL
    `,
    [commentId, resolvedBy]
  );
  return rowCount;
}
