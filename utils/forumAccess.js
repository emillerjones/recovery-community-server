import db from "#db/client";
import { canUseStaffChat } from "#utils/staffChatAccess";

// The reserved slug also protects staged deployments before/after the column exists.
// SQL aliases are supplied only by our own queries, never by a request.
export const staffCategorySql = (alias = "c") => `(${alias}.slug = 'staff-announcements' OR COALESCE(to_jsonb(${alias})->>'access_level', 'members') = 'staff')`;
export const publicPostSql = (alias = "p") => `NOT EXISTS (SELECT 1 FROM forum_categories access_category WHERE access_category.category_id = ${alias}.category_id AND ${staffCategorySql("access_category")})`;
export const readablePostSql = (alias, viewerParam) => `(${publicPostSql(alias)} OR EXISTS (SELECT 1 FROM users access_user WHERE access_user.user_id = ${viewerParam} AND access_user.role_id IN (1,10,50) AND access_user.active = TRUE AND access_user.deleted_at IS NULL AND access_user.account_status = 'approved' AND access_user.is_system = FALSE))`;

export async function getForumPostAccess(postId, user) {
  if (!Number.isSafeInteger(Number(postId)) || Number(postId) <= 0) return null;
  const { rows: [post] } = await db.query(
    `SELECT p.post_id, p.author_id, ${staffCategorySql()} AS staff_only
     FROM posts p JOIN forum_categories c ON c.category_id = p.category_id
     WHERE p.post_id = $1 AND p.active = TRUE AND p.deleted_at IS NULL AND c.active = TRUE`, [postId]);
  if (!post || (post.staff_only && !canUseStaffChat(user))) return null;
  return post;
}

export async function getForumCategoryAccess(categoryId) {
  const { rows: [category] } = await db.query(
    `SELECT c.category_id, ${staffCategorySql()} AS staff_only
     FROM forum_categories c WHERE c.category_id = $1 AND c.active = TRUE`, [categoryId]);
  return category;
}

export async function getStaffAcknowledgments(postId) {
  const { rows } = await db.query(
    `SELECT u.user_id, u.username FROM forum_reactions r JOIN users u ON u.user_id = r.user_id
     WHERE r.post_id = $1 AND r.reaction_type IN ('like', 'agree') AND u.role_id IN (1,10,50)
       AND u.active = TRUE AND u.deleted_at IS NULL AND u.account_status = 'approved' AND u.is_system = FALSE
     ORDER BY LOWER(u.username), u.user_id`, [postId]);
  return rows;
}
