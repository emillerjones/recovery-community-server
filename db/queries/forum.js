import db, { withTransaction } from "#db/client";
import { staffCategorySql, publicPostSql, readablePostSql } from "#utils/forumAccess";
import { createForumPoll, getForumPollForPost, getForumPollsForPosts } from "#db/queries/polls";

function mediaSelectionError() {
  const error = new Error("One or more photos are unavailable. Remove them and try again.");
  error.status = 400;
  return error;
}

async function attachPendingMedia(client, { mediaIds, userId, postId = null, commentId = null }) {
  if (!mediaIds.length) return [];

  const { rows: media } = await client.query(
    `SELECT asset.media_id, asset.format, asset.byte_size, asset.width, asset.height,
            selected.display_order
     FROM unnest($1::BIGINT[]) WITH ORDINALITY AS selected(media_id, display_order)
     JOIN media_assets asset ON asset.media_id = selected.media_id
     WHERE asset.uploaded_by = $2 AND asset.status = 'pending'
     ORDER BY selected.display_order
     FOR UPDATE OF asset`,
    [mediaIds, userId]
  );
  if (media.length !== mediaIds.length) throw mediaSelectionError();

  if (postId) {
    await client.query(
      `INSERT INTO forum_post_images (post_id, media_id, display_order)
       SELECT $1, media_id, display_order - 1
       FROM unnest($2::BIGINT[]) WITH ORDINALITY AS selected(media_id, display_order)`,
      [postId, mediaIds]
    );
  } else {
    await client.query(
      `INSERT INTO forum_comment_images (comment_id, media_id, display_order)
       SELECT $1, media_id, display_order - 1
       FROM unnest($2::BIGINT[]) WITH ORDINALITY AS selected(media_id, display_order)`,
      [commentId, mediaIds]
    );
  }

  await client.query(
    `UPDATE media_assets
     SET status = 'attached', attached_at = NOW()
     WHERE media_id = ANY($1::BIGINT[])`,
    [mediaIds]
  );
  return media.map(({ display_order, ...asset }) => ({
    ...asset,
    display_order: Number(display_order) - 1,
  }));
}

export async function getForumCategories({ includeStaff = false } = {}) {
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
      ${includeStaff ? "" : `AND NOT ${staffCategorySql()}`}
    GROUP BY c.category_id
    ORDER BY c.sort_order, c.name
  `);
  return rows;
}

export async function getForumTags({ includeInactive = false } = {}) {
  const { rows } = await db.query(`
    SELECT
      t.*,
      COUNT(pt.post_id)::INT AS post_count
    FROM forum_tags t
    LEFT JOIN forum_post_tags pt ON pt.tag_id = t.tag_id AND EXISTS (
      SELECT 1 FROM posts tagged_post WHERE tagged_post.post_id = pt.post_id
        AND tagged_post.active = TRUE AND tagged_post.deleted_at IS NULL AND ${publicPostSql("tagged_post")}
    )
    ${includeInactive ? "" : "WHERE t.active = TRUE"}
    GROUP BY t.tag_id
    ORDER BY t.sort_order, t.name
  `);
  return rows;
}

export async function createForumTag({ name, slug, description, createdBy }) {
  const { rows: [tag] } = await db.query(
    `INSERT INTO forum_tags (name, slug, description, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name.trim(), slug, description?.trim() || null, createdBy]
  );
  return tag;
}

export async function updateForumTag(tagId, { name, slug, description, active }) {
  const { rows: [tag] } = await db.query(
    `UPDATE forum_tags
     SET name = $2, slug = $3, description = $4, active = $5, updated_at = NOW()
     WHERE tag_id = $1
     RETURNING *`,
    [tagId, name.trim(), slug, description?.trim() || null, active]
  );
  return tag;
}

export async function getForumPosts({
  categorySlug, section = "community", tagSlugs = [], search,
  scope = "all", order = "recent", sort, viewerId, page = 0, limit = 20, includeStaff = false,
} = {}) {
  // FORUM LIST TRACE STEP 5: Every filter choice shares this one list-query
  // builder. Safe scope/order options from api/forum.js choose small SQL
  // fragments; tags remain a separate stackable filter.
  const values = [viewerId ?? null];
  // Older internal callers used `sort` for the member subset. Keep those
  // rollback-only integration tests and any queued server work compatible.
  if (sort === "mine") scope = "mine";
  if (sort === "saved") scope = "following";
  let categoryFilter = "";
  let searchFilter = "";
  let tagFilter = "";
  let memberFilter = "";
  let savedFilter = "";
  let unreadFilter = "";

  if (categorySlug) {
    values.push(categorySlug);
    categoryFilter = `AND c.slug = $${values.length}`;
  }

  if (!categorySlug && section === "announcements") {
    categoryFilter = "AND c.slug = 'announcements'";
  } else if (!categorySlug && section === "community") {
    categoryFilter = "AND c.slug NOT IN ('announcements', 'success-stories')";
  }
  const staffView = section === "staff" || categorySlug === "staff-announcements";
  if (staffView) categoryFilter = includeStaff ? `AND ${staffCategorySql()} AND ${readablePostSql("p", "$1")}` : "AND FALSE";
  else categoryFilter += ` AND NOT ${staffCategorySql()}`;

  if (search) {
    values.push(`%${search}%`);
    searchFilter = `AND (p.title ILIKE $${values.length} OR p.body ILIKE $${values.length})`;
  }

  if (tagSlugs.length) {
    values.push(tagSlugs);
    tagFilter = `AND EXISTS (
      SELECT 1
      FROM forum_post_tags filtered_pt
      JOIN forum_tags filtered_tag ON filtered_tag.tag_id = filtered_pt.tag_id
      WHERE filtered_pt.post_id = p.post_id
        AND filtered_tag.slug = ANY($${values.length}::TEXT[])
        AND filtered_tag.active = TRUE
    )`;
  }


  // `mine` means posts.author_id must equal the logged-in user's ID ($1).
  // `saved` checks that same user against the forum_saved_posts join table.
  if (scope === "mine") memberFilter = "AND p.author_id = $1";
  if (scope === "following") {
    savedFilter = `AND EXISTS (
      SELECT 1 FROM forum_saved_posts saved_filter
      WHERE saved_filter.post_id = p.post_id AND saved_filter.user_id = $1
    )`;
  }
  if (scope === "unread") {
    unreadFilter = `AND (
      forum_read.last_read_at IS NULL
      OR GREATEST(p.updated_at, COALESCE(comment_stats.latest_comment_at, p.updated_at))
        > forum_read.last_read_at
    )`;
  }

  // `discussed` changes the ordering; `recent` uses latest activity. Both put
  // pinned posts first, without issuing another database query.
  const orderBy = order === "discussed"
    ? "p.pinned DESC, comment_count DESC, latest_activity_at DESC, p.post_id DESC"
    : "p.pinned DESC, latest_activity_at DESC, p.post_id DESC";
  values.push(limit + 1, page * limit);
  const limitParameter = values.length - 1;
  const offsetParameter = values.length;

  // This is the actual PostgreSQL call. `FROM posts p` supplies one base row
  // per forum post. Joins/subqueries add the author, tags, comment count,
  // saved status, and reaction count that each PostCard needs.
  const { rows } = await db.query(
    `
      SELECT
        p.post_id,
        p.title,
        LEFT(p.body, 500) AS body,
        p.pinned,
        p.locked,
        p.created_at,
        c.slug AS category_slug,
        u.user_id AS author_id,
        p.is_imported,
        p.imported_author_label,
        CASE WHEN p.is_imported THEN p.imported_author_label ELSE u.username END AS author_username,
        CASE WHEN p.is_imported THEN NULL ELSE u.avatar_url END AS author_avatar_url,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'tag_id', tag.tag_id,
            'name', tag.name,
            'slug', tag.slug
          ) ORDER BY tag.sort_order, tag.name)
          FROM forum_post_tags post_tag
          JOIN forum_tags tag ON tag.tag_id = post_tag.tag_id
          WHERE post_tag.post_id = p.post_id AND tag.active = TRUE
        ), '[]'::jsonb) AS tags,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'media_id', asset.media_id,
            'width', asset.width,
            'height', asset.height,
            'format', asset.format
          ) ORDER BY image.display_order)
          FROM forum_post_images image
          JOIN media_assets asset ON asset.media_id = image.media_id
          WHERE image.post_id = p.post_id AND asset.status = 'attached'
        ), '[]'::jsonb) AS images,
        COALESCE(comment_stats.comment_count, 0)::INT AS comment_count,
        GREATEST(p.updated_at, COALESCE(comment_stats.latest_comment_at, p.updated_at)) AS latest_activity_at,
        (
          forum_read.last_read_at IS NULL
          OR GREATEST(p.updated_at, COALESCE(comment_stats.latest_comment_at, p.updated_at))
            > forum_read.last_read_at
        ) AS is_unread,
        EXISTS(
          SELECT 1 FROM forum_saved_posts sp
          WHERE sp.post_id = p.post_id AND sp.user_id = $1
        ) AS followed_by_me,
        (SELECT COUNT(*)::INT FROM forum_reactions fr WHERE fr.post_id = p.post_id) AS reaction_count
      FROM posts p
      JOIN forum_categories c ON c.category_id = p.category_id
      JOIN users u ON u.user_id = p.author_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS comment_count, MAX(cm.created_at) AS latest_comment_at
        FROM comments cm
        WHERE cm.post_id = p.post_id
          AND cm.active = TRUE
          AND cm.deleted_at IS NULL
      ) comment_stats ON TRUE
      LEFT JOIN forum_post_reads forum_read
        ON forum_read.post_id = p.post_id AND forum_read.user_id = $1
      WHERE p.active = TRUE
        AND p.deleted_at IS NULL
        AND c.active = TRUE
        ${categoryFilter}
        ${tagFilter}
        ${searchFilter}
        ${memberFilter}
        ${savedFilter}
        ${unreadFilter}
      ORDER BY ${orderBy}
      LIMIT $${limitParameter}
      OFFSET $${offsetParameter}
    `,
    values
  );
  // We request 21 rows for a 20-card page. The extra row is not displayed; it
  // only tells the browser whether infinite scrolling has another page.
  // Return to TRACE STEP 6 in Forum.jsx, where setPosts() refreshes the list.
  const hasMore = rows.length > limit;
  const posts = rows.slice(0, limit);
  const polls = await getForumPollsForPosts(posts.map((post) => post.post_id), viewerId);
  for (const post of posts) post.poll = polls.get(String(post.post_id)) || null;
  return { posts, has_more: hasMore, next_page: hasMore ? page + 1 : null };
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
        CASE WHEN p.is_imported THEN p.imported_author_label ELSE u.username END AS author_username,
        CASE WHEN p.is_imported THEN NULL ELSE u.avatar_url END AS author_avatar_url,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'tag_id', tag.tag_id,
            'name', tag.name,
            'slug', tag.slug
          ) ORDER BY tag.sort_order, tag.name)
          FROM forum_post_tags post_tag
          JOIN forum_tags tag ON tag.tag_id = post_tag.tag_id
          WHERE post_tag.post_id = p.post_id AND tag.active = TRUE
        ), '[]'::jsonb) AS tags,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'media_id', asset.media_id,
            'width', asset.width,
            'height', asset.height,
            'format', asset.format
          ) ORDER BY image.display_order)
          FROM forum_post_images image
          JOIN media_assets asset ON asset.media_id = image.media_id
          WHERE image.post_id = p.post_id AND asset.status = 'attached'
        ), '[]'::jsonb) AS images,
        editor.role_id AS content_edited_by_role_id,
        EXISTS(
          SELECT 1 FROM forum_content_flags flags
          WHERE flags.post_id = p.post_id
            AND flags.flagged_by = $2
            AND flags.reviewed_at IS NULL
        ) AS flagged_by_me,
        EXISTS(
          SELECT 1 FROM forum_saved_posts sp
          WHERE sp.post_id = p.post_id AND sp.user_id = $2
        ) AS followed_by_me,
        CASE WHEN p.author_id = $2 THEN (
          SELECT COUNT(*)::INT FROM forum_saved_posts followers
          WHERE followers.post_id = p.post_id
            AND followers.user_id <> p.author_id
        ) ELSE NULL END AS follower_count,
        COALESCE((
          SELECT jsonb_object_agg(t.reaction_type, t.reaction_count)
          FROM (
            SELECT reaction_type, COUNT(*)::INT AS reaction_count
            FROM forum_reactions
            WHERE post_id = p.post_id
            GROUP BY reaction_type
          ) t
        ), '{}'::jsonb) AS reactions,
        (
          SELECT reaction_type FROM forum_reactions
          WHERE post_id = p.post_id AND user_id = $2
        ) AS my_reaction,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'user_id', m.mentioned_user_id,
            'username', m.username_snapshot
          ) ORDER BY m.mention_id)
          FROM forum_mentions m
          WHERE m.post_id = p.post_id
        ), '[]'::jsonb) AS mentions,
        (
          SELECT cm.comment_id
          FROM comments cm
          WHERE cm.post_id = p.post_id
            AND cm.active = TRUE
            AND cm.deleted_at IS NULL
            AND cm.created_at > COALESCE((
              SELECT reads.last_read_at
              FROM forum_post_reads reads
              WHERE reads.post_id = p.post_id AND reads.user_id = $2
            ), '-infinity'::timestamp)
          ORDER BY cm.created_at, cm.comment_id
          LIMIT 1
        ) AS first_unread_comment_id
      FROM posts p
      JOIN forum_categories c ON c.category_id = p.category_id
      JOIN users u ON u.user_id = p.author_id
      LEFT JOIN users editor ON editor.user_id = p.content_edited_by
      WHERE p.post_id = $1
        AND p.active = TRUE
        AND p.deleted_at IS NULL
        AND ${readablePostSql("p", "$2")}
    `,
    [postId, viewerId]
  );
  if (post) post.poll = await getForumPollForPost(post.post_id, viewerId);
  return post;
}

export async function markForumPostRead(postId, userId) {
  // READ TRACE STEP 3: Opening a thread reaches this UPSERT. It records one
  // visit per member/post and remembers the newest visible reply at that time.
  const { rows: [read] } = await db.query(
    `INSERT INTO forum_post_reads (user_id, post_id, last_read_at, last_read_comment_id)
     SELECT $2, p.post_id, NOW(), (
       SELECT cm.comment_id
       FROM comments cm
       WHERE cm.post_id = p.post_id AND cm.active = TRUE AND cm.deleted_at IS NULL
       ORDER BY cm.created_at DESC, cm.comment_id DESC
       LIMIT 1
     )
     FROM posts p
     WHERE p.post_id = $1 AND p.active = TRUE AND p.deleted_at IS NULL
     ON CONFLICT (user_id, post_id) DO UPDATE
       SET last_read_at = EXCLUDED.last_read_at,
           last_read_comment_id = EXCLUDED.last_read_comment_id
     RETURNING *`,
    [postId, userId]
  );
  return read;
}

export async function getStaffAnnouncementsUnreadCount(userId) {
  const { rows: [{ unread_count }] } = await db.query(
    `
      SELECT COUNT(*)::INT AS unread_count
      FROM posts p
      JOIN forum_categories c ON c.category_id = p.category_id
      LEFT JOIN LATERAL (
        SELECT MAX(cm.created_at) AS latest_comment_at
        FROM comments cm
        WHERE cm.post_id = p.post_id AND cm.active = TRUE AND cm.deleted_at IS NULL
      ) comment_stats ON TRUE
      LEFT JOIN forum_post_reads forum_read
        ON forum_read.post_id = p.post_id AND forum_read.user_id = $1
      WHERE p.active = TRUE AND p.deleted_at IS NULL AND c.active = TRUE
        AND ${staffCategorySql()}
        AND (
          forum_read.last_read_at IS NULL
          OR GREATEST(p.updated_at, COALESCE(comment_stats.latest_comment_at, p.updated_at))
            > forum_read.last_read_at
        )
    `,
    [userId]
  );
  return unread_count;
}

export async function markAllForumPostsRead(userId, staffOnly = false) {
  // Mark-all intentionally creates rows for visible forum posts. This is the
  // one bulk action; ordinary browsing still creates rows only when opened.
  const { rowCount } = await db.query(
    `INSERT INTO forum_post_reads (user_id, post_id, last_read_at, last_read_comment_id)
     SELECT $1, p.post_id, NOW(), (
       SELECT cm.comment_id FROM comments cm
       WHERE cm.post_id = p.post_id AND cm.active = TRUE AND cm.deleted_at IS NULL
       ORDER BY cm.created_at DESC, cm.comment_id DESC LIMIT 1
     )
     FROM posts p
     JOIN forum_categories c ON c.category_id = p.category_id
     WHERE p.active = TRUE AND p.deleted_at IS NULL AND c.active = TRUE
       AND ${staffOnly ? `${staffCategorySql()} AND ${readablePostSql("p", "$1")}` : `NOT ${staffCategorySql()}`}
     ON CONFLICT (user_id, post_id) DO UPDATE
       SET last_read_at = EXCLUDED.last_read_at,
           last_read_comment_id = EXCLUDED.last_read_comment_id`,
    [userId]
  );
  return rowCount;
}

export async function getForumComments(postId, viewerId) {
  const { rows } = await db.query(
    `
      SELECT
        cm.comment_id,
        cm.post_id,
        cm.parent_comment_id,
        cm.author_id,
        cm.is_imported,
        cm.imported_author_label,
        cm.created_at,
        cm.updated_at,
        cm.deleted_at,
        cm.content_edited_at,
        cm.content_edited_by,
        editor.role_id AS content_edited_by_role_id,
        CASE WHEN cm.deleted_at IS NULL THEN cm.body ELSE NULL END AS body,
        CASE WHEN cm.deleted_at IS NULL THEN CASE WHEN cm.is_imported THEN cm.imported_author_label ELSE u.username END ELSE NULL END AS author_username,
        CASE WHEN cm.deleted_at IS NULL AND NOT cm.is_imported THEN u.avatar_url ELSE NULL END AS author_avatar_url,
        EXISTS(
          SELECT 1 FROM forum_content_flags flags
          WHERE flags.comment_id = cm.comment_id
            AND flags.flagged_by = $2
            AND flags.reviewed_at IS NULL
        ) AS flagged_by_me,
        COALESCE((
          SELECT jsonb_object_agg(t.reaction_type, t.reaction_count)
          FROM (
            SELECT reaction_type, COUNT(*)::INT AS reaction_count
            FROM forum_reactions
            WHERE comment_id = cm.comment_id
            GROUP BY reaction_type
          ) t
        ), '{}'::jsonb) AS reactions,
        (
          SELECT reaction_type FROM forum_reactions
          WHERE comment_id = cm.comment_id AND user_id = $2
        ) AS my_reaction,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'user_id', m.mentioned_user_id,
            'username', m.username_snapshot
          ) ORDER BY m.mention_id)
          FROM forum_mentions m
          WHERE m.comment_id = cm.comment_id
        ), '[]'::jsonb) AS mentions,
        CASE WHEN cm.deleted_at IS NULL THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'media_id', asset.media_id,
            'width', asset.width,
            'height', asset.height,
            'format', asset.format
          ) ORDER BY image.display_order)
          FROM forum_comment_images image
          JOIN media_assets asset ON asset.media_id = image.media_id
          WHERE image.comment_id = cm.comment_id AND asset.status = 'attached'
        ), '[]'::jsonb) ELSE '[]'::jsonb END AS images
      FROM comments cm
      JOIN users u ON u.user_id = cm.author_id
      LEFT JOIN users editor ON editor.user_id = cm.content_edited_by
      WHERE cm.post_id = $1
      ORDER BY cm.created_at
    `,
    [postId, viewerId]
  );
  return rows;
}

export async function createForumPost({
  categoryId, authorId, title, body, mediaIds = [], canPostAnnouncements = false, poll = null,
  isImported = false, importedAuthorLabel = null,
}) {
  // CREATE POST TRACE STEP 5: This is the actual write to the posts table.
  // The SELECT also confirms that the category is active and enforces the
  // announcement permission before PostgreSQL inserts anything.
  const post = await withTransaction(async (client) => {
    const { rows: [post] } = await client.query(
      `INSERT INTO posts (category_id, author_id, title, body, is_imported, imported_author_label)
       SELECT category_id, $2, $3, $4, $6, $7
       FROM forum_categories
       WHERE category_id = $1
         AND active = TRUE
         AND (slug <> 'announcements' OR $5 = TRUE)
         AND (NOT $6 OR EXISTS (
           SELECT 1 FROM users owner WHERE owner.user_id = $2 AND owner.role_id = 1
             AND owner.active = TRUE AND owner.deleted_at IS NULL
             AND owner.account_status = 'approved' AND owner.is_system = FALSE
         ))
         AND (NOT ${staffCategorySql("forum_categories")} OR EXISTS (
           SELECT 1 FROM users staff WHERE staff.user_id = $2 AND staff.role_id IN (1,10,50)
             AND staff.active = TRUE AND staff.deleted_at IS NULL AND staff.account_status = 'approved' AND staff.is_system = FALSE
         ))
       RETURNING *`,
      [categoryId, authorId, title.trim(), body.trim(), canPostAnnouncements, isImported, importedAuthorLabel]
    );
    if (!post) return post;
    post.images = await attachPendingMedia(client, {
      mediaIds,
      userId: authorId,
      postId: post.post_id,
    });
    if (poll) await createForumPoll(client, post.post_id, poll);
    return post;
  });
  if (post) post.poll = await getForumPollForPost(post.post_id, authorId);
  return post;
}

export async function setForumPostTags(postId, tagIds) {
  if (!tagIds.length) return [];
  const { rows } = await db.query(
    `WITH inserted AS (
       INSERT INTO forum_post_tags (post_id, tag_id)
       SELECT $1, tag_id
       FROM forum_tags
       WHERE tag_id = ANY($2::INT[]) AND active = TRUE
       ON CONFLICT DO NOTHING
       RETURNING tag_id
     )
     SELECT t.tag_id, t.name, t.slug
     FROM inserted i
     JOIN forum_tags t ON t.tag_id = i.tag_id
     ORDER BY t.sort_order, t.name`,
    [postId, tagIds]
  );
  return rows;
}

export async function createForumComment({ postId, authorId, parentCommentId, body, mediaIds = [], isImported = false, importedAuthorLabel = null }) {
  return withTransaction(async (client) => {
    const { rows: [comment] } = await client.query(
      `WITH inserted AS (
         INSERT INTO comments (post_id, author_id, parent_comment_id, body, is_imported, imported_author_label)
         SELECT p.post_id, $2, $3, $4, $5, $6
         FROM posts p
         WHERE p.post_id = $1
           AND p.active = TRUE
           AND p.deleted_at IS NULL
           AND p.locked = FALSE
           AND (NOT $5 OR EXISTS (SELECT 1 FROM users creator WHERE creator.user_id = $2 AND creator.role_id = 1))
         RETURNING *
       )
       SELECT inserted.*, CASE WHEN inserted.is_imported THEN inserted.imported_author_label ELSE u.username END AS author_username,
         CASE WHEN inserted.is_imported THEN NULL ELSE u.avatar_url END AS author_avatar_url,
         FALSE AS flagged_by_me,
         '{}'::jsonb AS reactions,
         NULL::TEXT AS my_reaction,
         '[]'::jsonb AS mentions
       FROM inserted
       JOIN users u ON u.user_id = inserted.author_id`,
      [postId, authorId, parentCommentId, body.trim(), isImported, importedAuthorLabel]
    );
    if (!comment) return comment;
    comment.images = await attachPendingMedia(client, {
      mediaIds,
      userId: authorId,
      commentId: comment.comment_id,
    });
    return comment;
  });
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

export async function getForumPostHistory(postId) {
  const { rows } = await db.query(
    `SELECT r.revision_id, r.previous_title, r.previous_body, r.created_at,
            u.username AS editor_username
     FROM forum_post_revisions r
     JOIN posts p ON p.post_id = r.post_id
     LEFT JOIN users u ON u.user_id = r.edited_by
     WHERE r.post_id = $1 AND p.active = TRUE AND p.deleted_at IS NULL
     ORDER BY r.created_at DESC, r.revision_id DESC`,
    [postId],
  );
  return rows;
}

export async function updateForumPost(postId, actorId, canEditOwn, canEditOthers, { title, body }) {
  const fields = [];
  const changeChecks = [];
  const values = [];

  if (title) {
    values.push(title.trim());
    fields.push(`title = $${values.length}`);
    changeChecks.push(`p.title IS DISTINCT FROM $${values.length}`);
  }
  if (body) {
    values.push(body.trim());
    fields.push(`body = $${values.length}`);
    changeChecks.push(`p.body IS DISTINCT FROM $${values.length}`);
  }
  if (!fields.length) return null;

  values.push(postId, actorId, canEditOwn, canEditOthers);
  const postIdParameter = values.length - 3;
  const actorIdParameter = values.length - 2;
  const canEditOwnParameter = values.length - 1;
  const canEditOthersParameter = values.length;
  const {
    rows: [post],
  } = await db.query(
    `
      -- EDIT HISTORY TRACE STEP 4: lock and capture the current wording before
      -- changing it. One SQL statement makes the snapshot + edit atomic.
      WITH previous AS MATERIALIZED (
        SELECT p.*
        FROM posts p
        WHERE p.post_id = $${postIdParameter}
          AND (
            (p.author_id = $${actorIdParameter} AND $${canEditOwnParameter})
            OR $${canEditOthersParameter}
          )
          AND p.deleted_at IS NULL
          AND p.active = TRUE
        FOR UPDATE
      ),
      updated AS (
        UPDATE posts p
        SET ${fields.join(", ")},
            content_edited_at = NOW(),
            content_edited_by = $${actorIdParameter},
            updated_at = NOW()
        FROM previous
        WHERE p.post_id = previous.post_id
          AND (${changeChecks.join(" OR ")})
        RETURNING p.*
      ),
      revision AS (
        INSERT INTO forum_post_revisions
          (post_id, edited_by, previous_title, previous_body)
        SELECT previous.post_id, $${actorIdParameter}, previous.title, previous.body
        FROM previous
        JOIN updated ON updated.post_id = previous.post_id
        RETURNING revision_id
      )
      SELECT updated.*, editor.role_id AS content_edited_by_role_id
      FROM updated
      CROSS JOIN revision
      LEFT JOIN users editor ON editor.user_id = updated.content_edited_by
    `,
    values
  );
  return post;
}

export async function updateForumComment(postId, commentId, actorId, canEditOwn, canEditOthers, body) {
  const { rows: [comment] } = await db.query(
    `
      -- COMMENT EDIT TRACE STEP 4: lock the existing reply, update it, and
      -- preserve the old wording + real editor in one atomic SQL statement.
      WITH previous AS MATERIALIZED (
        SELECT cm.*
        FROM comments cm
        WHERE cm.post_id = $1
          AND cm.comment_id = $2
          AND ((cm.author_id = $3 AND $4) OR $5)
          AND cm.deleted_at IS NULL
        FOR UPDATE
      ), updated AS (
        UPDATE comments cm
        SET body = $6,
            content_edited_at = NOW(),
            content_edited_by = $3,
            updated_at = NOW()
        FROM previous
        WHERE cm.comment_id = previous.comment_id
          AND cm.body IS DISTINCT FROM $6
        RETURNING cm.*
      ), revision AS (
        INSERT INTO forum_comment_revisions (comment_id, edited_by, previous_body)
        SELECT previous.comment_id, $3, previous.body
        FROM previous
        JOIN updated ON updated.comment_id = previous.comment_id
        RETURNING revision_id
      )
      SELECT updated.*, CASE WHEN updated.is_imported THEN updated.imported_author_label ELSE u.username END AS author_username,
        CASE WHEN updated.is_imported THEN NULL ELSE u.avatar_url END AS author_avatar_url,
        editor.role_id AS content_edited_by_role_id
      FROM updated
      CROSS JOIN revision
      JOIN users u ON u.user_id = updated.author_id
      LEFT JOIN users editor ON editor.user_id = updated.content_edited_by
    `,
    [postId, commentId, actorId, canEditOwn, canEditOthers, body.trim()]
  );
  return comment;
}

export async function softDeleteForumPost(postId, actorId, canDeleteOthers = false) {
  const {
    rows: [post],
  } = await db.query(
    `
      WITH deleted_post AS (
        UPDATE posts
        SET active = FALSE, deleted_at = NOW(), updated_at = NOW()
        WHERE post_id = $1
          AND deleted_at IS NULL
          AND (author_id = $2 OR $3)
        RETURNING *
      ), deleted_comments AS (
        UPDATE comments
        SET active = FALSE, deleted_at = NOW(), updated_at = NOW()
        WHERE post_id = (SELECT post_id FROM deleted_post)
          AND deleted_at IS NULL
        RETURNING comment_id
      )
      SELECT deleted_post.*,
        (SELECT COUNT(*)::INT FROM deleted_comments) AS deleted_comment_count
      FROM deleted_post
    `,
    [postId, actorId, canDeleteOthers]
  );
  return post;
}

export async function softDeleteForumComment(postId, commentId, actorId, canDeleteOthers = false) {
  const {
    rows: [comment],
  } = await db.query(
    `
      WITH RECURSIVE permitted_root AS (
        SELECT *
        FROM comments
        WHERE post_id = $1
          AND comment_id = $2
          AND deleted_at IS NULL
          AND (author_id = $3 OR $4)
      ), comment_branch AS (
        SELECT comment_id
        FROM permitted_root
        UNION ALL
        SELECT child.comment_id
        FROM comments child
        JOIN comment_branch parent ON child.parent_comment_id = parent.comment_id
        WHERE child.post_id = $1 AND child.deleted_at IS NULL
      ), deleted_comments AS (
        UPDATE comments
        SET active = FALSE, deleted_at = NOW(), updated_at = NOW()
        WHERE comment_id IN (SELECT comment_id FROM comment_branch)
        RETURNING *
      )
      SELECT root.*, branch.deleted_count
      FROM deleted_comments root
      CROSS JOIN (
        SELECT COUNT(*)::INT AS deleted_count FROM deleted_comments
      ) branch
      WHERE root.comment_id = $2
    `,
    [postId, commentId, actorId, canDeleteOthers]
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
      WITH inserted AS (
        INSERT INTO forum_content_flags (comment_id, flagged_by, reason)
        SELECT comment_id, $2, $3
        FROM comments
        WHERE comment_id = $1
          AND author_id <> $2
          AND deleted_at IS NULL
        ON CONFLICT DO NOTHING
        RETURNING *
      )
      SELECT inserted.*, comments.post_id
      FROM inserted
      JOIN comments ON comments.comment_id = inserted.comment_id
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
      p.created_at,
      p.body,
      p.author_id,
      p.is_imported,
      p.imported_author_label,
      CASE WHEN p.is_imported THEN p.imported_author_label ELSE u.username END AS author_username,
      CASE WHEN p.is_imported THEN NULL ELSE u.avatar_url END AS author_avatar_url,
      COUNT(flags.flag_id)::INT AS flag_count,
      MAX(flags.created_at) AS last_flagged_at,
      jsonb_agg(jsonb_build_object('flag_id', flags.flag_id, 'reporter_id', reporter.user_id,
        'reporter_username', reporter.username, 'reporter_avatar_url', reporter.avatar_url, 'reason', flags.reason, 'created_at', flags.created_at)
        ORDER BY flags.created_at, flags.flag_id) AS reports
    FROM forum_content_flags flags
    JOIN users reporter ON reporter.user_id = flags.flagged_by
    JOIN posts p ON p.post_id = flags.post_id
    JOIN users u ON u.user_id = p.author_id
    WHERE flags.post_id IS NOT NULL
      AND flags.reviewed_at IS NULL
    GROUP BY p.post_id, u.username, u.avatar_url
    ORDER BY flag_count DESC, last_flagged_at DESC
  `);
  return rows;
}

export async function getFlaggedForumComments() {
  const { rows } = await db.query(`
    SELECT
      cm.comment_id,
      cm.created_at,
      cm.parent_comment_id,
      cm.post_id,
      cm.body,
      cm.author_id,
      CASE WHEN cm.is_imported THEN cm.imported_author_label ELSE u.username END AS author_username,
      CASE WHEN cm.is_imported THEN NULL ELSE u.avatar_url END AS author_avatar_url,
      COUNT(flags.flag_id)::INT AS flag_count,
      MAX(flags.created_at) AS last_flagged_at,
      jsonb_agg(jsonb_build_object('flag_id', flags.flag_id, 'reporter_id', reporter.user_id,
        'reporter_username', reporter.username, 'reporter_avatar_url', reporter.avatar_url, 'reason', flags.reason, 'created_at', flags.created_at)
        ORDER BY flags.created_at, flags.flag_id) AS reports
    FROM forum_content_flags flags
    JOIN users reporter ON reporter.user_id = flags.flagged_by
    JOIN comments cm ON cm.comment_id = flags.comment_id
    JOIN users u ON u.user_id = cm.author_id
    WHERE flags.comment_id IS NOT NULL
      AND flags.reviewed_at IS NULL
    GROUP BY cm.comment_id, u.username, u.avatar_url
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

export async function followForumPost(postId, userId) {
  await db.query(
    `
      INSERT INTO forum_saved_posts (user_id, post_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `,
    [userId, postId]
  );
}

export async function unfollowForumPost(postId, userId) {
  await db.query(
    `DELETE FROM forum_saved_posts WHERE user_id = $1 AND post_id = $2`,
    [userId, postId]
  );
}

export async function setForumPostReaction(postId, userId, reactionType) {
  // REACTION TRACE STEP 5A: This is where a post reaction reaches PostgreSQL.
  // INSERT creates the member's first reaction. ON CONFLICT updates that same
  // row when the member changes from one reaction type to another.
  const { rows: [reaction] } = await db.query(
    `
      WITH prior AS (
        SELECT reaction_id FROM forum_reactions WHERE post_id = $1 AND user_id = $2
      )
      INSERT INTO forum_reactions (user_id, post_id, reaction_type)
      SELECT $2, p.post_id, $3
      FROM posts p
      WHERE p.post_id = $1 AND p.active = TRUE AND p.deleted_at IS NULL
      ON CONFLICT (post_id, user_id) WHERE post_id IS NOT NULL
      DO UPDATE SET reaction_type = EXCLUDED.reaction_type, updated_at = NOW()
      RETURNING *, NOT EXISTS (SELECT 1 FROM prior) AS was_new
    `,
    [postId, userId, reactionType]
  );
  return reaction || null;
}

export async function removeForumPostReaction(postId, userId) {
  // REACTION TRACE STEP 5C: DELETE the one row connecting this member to this
  // post. Control then returns to the DELETE route in api/forum.js.
  await db.query(`DELETE FROM forum_reactions WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
}

export async function setForumCommentReaction(commentId, userId, reactionType) {
  // REACTION TRACE STEP 5B: Same database behavior as a post reaction, except
  // comment_id connects the row to one specific forum reply.
  const { rows: [reaction] } = await db.query(
    `
      WITH prior AS (
        SELECT reaction_id FROM forum_reactions WHERE comment_id = $1 AND user_id = $2
      )
      INSERT INTO forum_reactions (user_id, comment_id, reaction_type)
      SELECT $2, cm.comment_id, $3
      FROM comments cm
      JOIN posts p ON p.post_id = cm.post_id
      WHERE cm.comment_id = $1
        AND cm.deleted_at IS NULL
        AND p.active = TRUE
        AND p.deleted_at IS NULL
      ON CONFLICT (comment_id, user_id) WHERE comment_id IS NOT NULL
      DO UPDATE SET reaction_type = EXCLUDED.reaction_type, updated_at = NOW()
      RETURNING *, NOT EXISTS (SELECT 1 FROM prior) AS was_new
    `,
    [commentId, userId, reactionType]
  );
  return reaction || null;
}

export async function removeForumCommentReaction(commentId, userId) {
  // REACTION TRACE STEP 5D: Remove this member's reaction from this reply.
  await db.query(`DELETE FROM forum_reactions WHERE comment_id = $1 AND user_id = $2`, [commentId, userId]);
}

export async function getForumReactionTarget({ postId, commentId }) {
  if (commentId) {
    const { rows: [target] } = await db.query(
      `SELECT cm.author_id, cm.post_id, cm.comment_id FROM comments cm WHERE cm.comment_id = $1 AND cm.deleted_at IS NULL`,
      [commentId]
    );
    return target || null;
  }
  const { rows: [target] } = await db.query(
    `SELECT author_id, post_id, NULL::INT AS comment_id FROM posts WHERE post_id = $1 AND deleted_at IS NULL`,
    [postId]
  );
  return target || null;
}

export async function createForumMentions({ mentionedUsers, mentionedBy, postId = null, commentId = null }) {
  if (!mentionedUsers.length) return [];

  // MENTION TRACE STEP 9: The post/reply now exists. Insert one row for each
  // verified @member. The partial unique indexes guarantee the same member can
  // only be mentioned once in this particular post or reply.
  const userIds = mentionedUsers.map((user) => user.user_id);
  const usernames = mentionedUsers.map((user) => user.username);
  const { rows } = await db.query(
    `
      INSERT INTO forum_mentions
        (mentioned_user_id, mentioned_by, post_id, comment_id, username_snapshot)
      SELECT member.user_id, $3, $4, $5, member.username
      FROM unnest($1::INT[], $2::TEXT[]) AS member(user_id, username)
      ON CONFLICT DO NOTHING
      RETURNING mentioned_user_id, username_snapshot
    `,
    [userIds, usernames, mentionedBy, postId, commentId]
  );
  return rows;
}
