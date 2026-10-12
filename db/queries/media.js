import db, { withTransaction } from "#db/client";
import { readablePostSql } from "#utils/forumAccess";

export async function createPendingMedia({ uploadedBy, providerAssetId, format, byteSize, width, height }) {
  const { rows: [media] } = await db.query(
    `INSERT INTO media_assets (
       uploaded_by, provider_asset_id, format, byte_size, width, height
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING media_id, format, byte_size, width, height, status, created_at`,
    [uploadedBy, providerAssetId, format, byteSize, width, height]
  );
  return media;
}

export async function getViewableMedia(mediaId, userId) {
  const { rows: [media] } = await db.query(
    `SELECT ma.*
     FROM media_assets ma
     WHERE ma.media_id = $1
       AND ma.status <> 'deleted'
       AND (
         (ma.status = 'pending' AND ma.uploaded_by = $2)
         OR EXISTS (
           SELECT 1 FROM forum_post_images image
           JOIN posts post ON post.post_id = image.post_id
           WHERE image.media_id = ma.media_id
             AND post.active = TRUE AND post.deleted_at IS NULL
             AND ${readablePostSql("post", "$2")}
         )
         OR EXISTS (
           SELECT 1 FROM forum_comment_images image
           JOIN comments comment ON comment.comment_id = image.comment_id
           JOIN posts post ON post.post_id = comment.post_id
           WHERE image.media_id = ma.media_id
             AND comment.active = TRUE AND comment.deleted_at IS NULL
             AND post.active = TRUE AND post.deleted_at IS NULL
             AND ${readablePostSql("post", "$2")}
         )
         OR EXISTS (
           SELECT 1 FROM direct_message_images image
           JOIN direct_messages message ON message.message_id = image.message_id
           JOIN direct_conversations conversation
             ON conversation.conversation_id = message.conversation_id
           WHERE image.media_id = ma.media_id
             AND (conversation.user_one_id = $2 OR conversation.user_two_id = $2)
         )
         OR EXISTS (
           SELECT 1 FROM users profile
           WHERE profile.avatar_media_id = ma.media_id
             AND profile.active = TRUE
             AND profile.deleted_at IS NULL
         )
       )`,
    [mediaId, userId]
  );
  return media;
}

export async function attachProfileAvatar(mediaId, userId) {
  return withTransaction(async (client) => {
    const { rows: [media] } = await client.query(
      `SELECT media_id
       FROM media_assets
       WHERE media_id = $1 AND uploaded_by = $2 AND status = 'pending'
       FOR UPDATE`,
      [mediaId, userId]
    );
    if (!media) {
      const error = new Error("That uploaded photo is unavailable.");
      error.status = 400;
      throw error;
    }

    const { rows: [previous] } = await client.query(
      `SELECT asset.media_id, asset.provider_asset_id
       FROM users profile
       LEFT JOIN media_assets asset ON asset.media_id = profile.avatar_media_id
       WHERE profile.user_id = $1
       FOR UPDATE OF profile`,
      [userId]
    );
    const { rows: [user] } = await client.query(
      `UPDATE users
       SET avatar_media_id = $2, avatar_url = $3, updated_at = NOW()
       WHERE user_id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [userId, mediaId, `media:${mediaId}`]
    );
    if (!user) {
      const error = new Error("Profile not found.");
      error.status = 404;
      throw error;
    }
    await client.query(
      `UPDATE media_assets SET status = 'attached', attached_at = NOW()
       WHERE media_id = $1`,
      [mediaId]
    );
    if (previous?.media_id && String(previous.media_id) !== String(mediaId)) {
      await client.query(
        `UPDATE media_assets SET status = 'deleted', deleted_at = NOW()
         WHERE media_id = $1`,
        [previous.media_id]
      );
    }
    return { user, retiredProviderAssetId: previous?.provider_asset_id || null };
  });
}

export async function deletePendingMedia(mediaId, userId) {
  const { rows: [media] } = await db.query(
    `UPDATE media_assets
     SET status = 'deleted', deleted_at = NOW()
     WHERE media_id = $1 AND uploaded_by = $2 AND status = 'pending'
     RETURNING *`,
    [mediaId, userId]
  );
  return media;
}

export async function restorePendingMedia(mediaId, userId) {
  await db.query(
    `UPDATE media_assets
     SET status = 'pending', deleted_at = NULL
     WHERE media_id = $1 AND uploaded_by = $2 AND status = 'deleted'`,
    [mediaId, userId]
  );
}

export async function expireAbandonedMedia(limit = 10) {
  const { rows } = await db.query(
    `WITH expired AS (
       SELECT media_id
       FROM media_assets
       WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours'
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE media_assets asset
     SET status = 'deleted', deleted_at = NOW()
     FROM expired
     WHERE asset.media_id = expired.media_id
     RETURNING asset.provider_asset_id`,
    [limit]
  );
  return rows;
}
