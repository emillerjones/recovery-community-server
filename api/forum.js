import express from "express";
import requireUser from "#middleware/requireUser";
import {
  createForumComment,
  createForumPost,
  getForumCategories,
  getForumComments,
  getForumNotificationRecipient,
  getForumPostById,
  getForumPosts,
  getFlaggedForumComments,
  getFlaggedForumPosts,
  flagForumComment,
  flagForumPost,
  reviewForumCommentFlags,
  reviewForumPostFlags,
  saveForumPost,
  softDeleteForumComment,
  softDeleteForumPost,
  unflagForumComment,
  unflagForumPost,
  unsaveForumPost,
  updateForumPost,
  updateForumPostModeration,
} from "#db/queries/forum";
import { createNotification } from "#db/queries/notifications";
import { notifyThread, notifyUser } from "#utils/socket";

const router = express.Router();

router.use(requireUser);

router.get("/categories", async (req, res) => {
  res.send(await getForumCategories());
});

router.get("/posts", async (req, res) => {
  res.send(await getForumPosts({
    categorySlug: req.query.category,
    search: req.query.search,
    viewerId: req.user.user_id,
  }));
});

router.get("/posts/:id", async (req, res) => {
  const post = await getForumPostById(Number(req.params.id), req.user.user_id);
  if (!post) return res.status(404).send({ message: "Post not found." });

  const comments = await getForumComments(post.post_id, req.user.user_id);
  res.send({ post, comments });
});

router.post("/posts", async (req, res) => {
  const categoryId = Number(req.body.category_id);
  const title = req.body.title?.trim();
  const body = req.body.body?.trim();

  if (!Number.isInteger(categoryId) || !title || !body) {
    return res.status(400).send({ message: "Category, title, and message are required." });
  }

  const post = await createForumPost({
    categoryId,
    authorId: req.user.user_id,
    title,
    body,
  });

  if (!post) return res.status(400).send({ message: "That category is unavailable." });
  res.status(201).send(post);
});

router.post("/posts/:id/comments", async (req, res) => {
  const postId = Number(req.params.id);
  const body = req.body.body?.trim();
  const parentCommentId = req.body.parent_comment_id == null
    ? null
    : Number(req.body.parent_comment_id);

  if (!Number.isInteger(postId) || !body) {
    return res.status(400).send({ message: "A reply is required." });
  }
  if (parentCommentId !== null && !Number.isInteger(parentCommentId)) {
    return res.status(400).send({ message: "Invalid parent comment." });
  }

  // TRACE STEP 1: Save the member's reply in the comments table first.
  // createForumComment() contains the SQL and returns the newly saved row.
  const comment = await createForumComment({
    postId,
    authorId: req.user.user_id,
    parentCommentId,
    body,
  });

  // If the post is missing, deleted, or locked, no comment was created.
  // Stop here so we do not try to notify anyone about a reply that does not exist.
  if (!comment) return res.status(400).send({ message: "This conversation is unavailable or locked." });

  notifyThread(postId, "new_comment", comment);

  try {
    // TRACE STEP 2: Decide who should receive the notification.
    // - A normal reply notifies the person who created the original post.
    // - A nested reply notifies the person who wrote the parent comment.
    const recipientId = await getForumNotificationRecipient(postId, parentCommentId);

    // Do not create a notification when there is no recipient or when the
    // member is replying to their own post/comment.
    if (recipientId && recipientId !== req.user.user_id) {
      // TRACE STEP 3: Save a permanent notification row in PostgreSQL.
      // actorId is the member who replied; userId is the member receiving it.
      const notification = await createNotification({
        userId: recipientId,
        actorId: req.user.user_id,
        type: parentCommentId ? "reply_to_comment" : "reply_to_post",
        postId,
        commentId: comment.comment_id,
      });

      // TRACE STEP 4: Push that saved notification to the recipient's browser
      // immediately through Socket.IO. The database row still exists if the
      // recipient is offline and will be fetched when they return.
      notifyUser(recipientId, "notification", notification);
    }
  } catch (error) {
    // The reply is already saved. A notification failure should not make
    // the client retry the reply and accidentally create a duplicate.
    console.error("Failed to create forum reply notification:", error);
  }

  res.status(201).send(comment);
});

router.patch("/posts/:id", async (req, res) => {
  const postId = Number(req.params.id);
  const title = req.body.title?.trim();
  const body = req.body.body?.trim();

  if (!title && !body) {
    return res.status(400).send({ message: "Nothing to update." });
  }

  const post = await updateForumPost(postId, req.user.user_id, { title, body });
  if (!post) return res.status(404).send({ message: "Post not found, locked, or not yours to edit." });
  res.send(post);
});

router.delete("/posts/:id", async (req, res) => {
  const postId = Number(req.params.id);
  const isModerator = req.user.role_id <= 50;

  const post = await softDeleteForumPost(postId, req.user.user_id, isModerator);
  if (!post) return res.status(404).send({ message: "Post not found or not yours to delete." });
  res.send(post);
});

router.delete("/posts/:id/comments/:commentId", async (req, res) => {
  const commentId = Number(req.params.commentId);
  const isModerator = req.user.role_id <= 50;

  const comment = await softDeleteForumComment(commentId, req.user.user_id, isModerator);
  if (!comment) return res.status(404).send({ message: "Reply not found or not yours to delete." });
  res.send(comment);
});

router.patch("/posts/:id/moderation", async (req, res) => {
  if (req.user.role_id > 50) {
    return res.status(403).send({ message: "Moderator access required." });
  }

  const post = await updateForumPostModeration(Number(req.params.id), req.body);
  if (!post) return res.status(400).send({ message: "No valid moderation change was provided." });
  res.send(post);
});

router.post("/posts/:id/flag", async (req, res) => {
  const postId = Number(req.params.id);
  const reason = req.body.reason?.trim() || null;

  const flag = await flagForumPost(postId, req.user.user_id, reason);
  if (!flag) return res.status(400).send({ message: "This content cannot be flagged or is already flagged by you." });
  res.status(201).send({ flagged: true });
});

router.delete("/posts/:id/flag", async (req, res) => {
  await unflagForumPost(Number(req.params.id), req.user.user_id);
  res.send({ flagged: false });
});

router.post("/posts/:id/save", async (req, res) => {
  await saveForumPost(Number(req.params.id), req.user.user_id);
  res.status(201).send({ saved: true });
});

router.delete("/posts/:id/save", async (req, res) => {
  await unsaveForumPost(Number(req.params.id), req.user.user_id);
  res.send({ saved: false });
});

router.post("/posts/:id/comments/:commentId/flag", async (req, res) => {
  const commentId = Number(req.params.commentId);
  const reason = req.body.reason?.trim() || null;

  const flag = await flagForumComment(commentId, req.user.user_id, reason);
  if (!flag) return res.status(400).send({ message: "This content cannot be flagged or is already flagged by you." });
  res.status(201).send({ flagged: true });
});

router.delete("/posts/:id/comments/:commentId/flag", async (req, res) => {
  await unflagForumComment(Number(req.params.commentId), req.user.user_id);
  res.send({ flagged: false });
});

router.get("/moderation/flags", async (req, res) => {
  if (req.user.role_id > 50) {
    return res.status(403).send({ message: "Moderator access required." });
  }

  const [posts, comments] = await Promise.all([
    getFlaggedForumPosts(),
    getFlaggedForumComments(),
  ]);
  res.send({ posts, comments });
});

router.patch("/moderation/flags/posts/:id/review", async (req, res) => {
  if (req.user.role_id > 50) {
    return res.status(403).send({ message: "Moderator access required." });
  }

  await reviewForumPostFlags(Number(req.params.id), req.user.user_id);
  res.send({ reviewed: true });
});

router.patch("/moderation/flags/comments/:id/review", async (req, res) => {
  if (req.user.role_id > 50) {
    return res.status(403).send({ message: "Moderator access required." });
  }

  await reviewForumCommentFlags(Number(req.params.id), req.user.user_id);
  res.send({ reviewed: true });
});

export default router;
