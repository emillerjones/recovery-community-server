import assert from "node:assert/strict";
import fs from "node:fs/promises";
import db from "#db/client";
import {
  createForumComment,
  createForumPost,
  getForumComments,
  getForumPostById,
  getForumPosts,
} from "#db/queries/forum";

const schemaName = "codex_forum_photos_integration";

await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await db.query(`CREATE SCHEMA ${schemaName}`);
  await db.query(`SET LOCAL search_path TO ${schemaName}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));

  await db.query("INSERT INTO user_roles (role_id, role_name) VALUES (100, 'Member')");
  const { rows: users } = await db.query(
    `INSERT INTO users (role_id, email, password, username, account_status)
     VALUES (100, 'photo-owner@example.com', 'unused', 'photo-owner', 'pending'),
            (100, 'other-owner@example.com', 'unused', 'other-owner', 'pending')
     RETURNING user_id, username`
  );
  const owner = users.find((user) => user.username === "photo-owner");
  const other = users.find((user) => user.username === "other-owner");
  const { rows: [category] } = await db.query(
    `INSERT INTO forum_categories (name, slug) VALUES ('Main Forum', 'main-forum') RETURNING *`
  );
  const { rows: media } = await db.query(
    `INSERT INTO media_assets (
       uploaded_by, provider_asset_id, format, byte_size, width, height
     ) VALUES
       ($1, 'test/post-one', 'webp', 100, 800, 600),
       ($1, 'test/post-two', 'webp', 110, 600, 800),
       ($1, 'test/comment-one', 'webp', 120, 900, 700),
       ($2, 'test/not-owned', 'webp', 130, 700, 900)
     RETURNING *`,
    [owner.user_id, other.user_id]
  );

  const post = await createForumPost({
    categoryId: category.category_id,
    authorId: owner.user_id,
    title: "Photo post",
    body: "A post with protected photos.",
    mediaIds: [media[0].media_id, media[1].media_id],
  });
  assert.equal(post.images.length, 2);
  assert.deepEqual(post.images.map((image) => String(image.media_id)), [
    String(media[0].media_id), String(media[1].media_id),
  ]);

  const listed = await getForumPosts({ viewerId: owner.user_id });
  assert.equal(listed.posts[0].images.length, 2);
  assert.equal((await getForumPostById(post.post_id, owner.user_id)).images.length, 2);

  const comment = await createForumComment({
    postId: post.post_id,
    authorId: owner.user_id,
    parentCommentId: null,
    body: "A reply with a photo.",
    mediaIds: [media[2].media_id],
  });
  assert.equal(comment.images.length, 1);
  assert.equal((await getForumComments(post.post_id, owner.user_id))[0].images.length, 1);

  const beforeRejectedPost = await db.query("SELECT COUNT(*)::INT AS count FROM posts");
  await assert.rejects(
    createForumPost({
      categoryId: category.category_id,
      authorId: owner.user_id,
      title: "Rejected photo",
      body: "This should roll back.",
      mediaIds: [media[3].media_id],
    }),
    /photos are unavailable/
  );
  const afterRejectedPost = await db.query("SELECT COUNT(*)::INT AS count FROM posts");
  assert.equal(afterRejectedPost.rows[0].count, beforeRejectedPost.rows[0].count);

  console.log("FORUM_PHOTOS_INTEGRATION_OK post_images=2 comment_images=1 ownership=protected");
} finally {
  await db.query("ROLLBACK").catch(() => {});
  await db.end();
}
