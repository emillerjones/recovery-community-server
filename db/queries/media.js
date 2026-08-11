import db from "#db/client";

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
         )
         OR EXISTS (
           SELECT 1 FROM forum_comment_images image
           JOIN comments comment ON comment.comment_id = image.comment_id
           JOIN posts post ON post.post_id = comment.post_id
           WHERE image.media_id = ma.media_id
             AND comment.active = TRUE AND comment.deleted_at IS NULL
             AND post.active = TRUE AND post.deleted_at IS NULL
         )
       )`,
    [mediaId, userId]
  );
  return media;
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
