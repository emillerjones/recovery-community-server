import express from "express";
import requireUser from "#middleware/requireUser";
import {
  createForumComment,
  createForumPost,
  getForumCategories,
  getForumComments,
  getForumPostById,
  getForumPosts,
  getReportedForumComments,
  getReportedForumPosts,
  reportForumComment,
  reportForumPost,
  resolveForumCommentReports,
  resolveForumPostReports,
  softDeleteForumComment,
  softDeleteForumPost,
  unreportForumComment,
  unreportForumPost,
  updateForumPost,
  updateForumPostModeration,
} from "#db/queries/forum";

const router = express.Router();

router.use(requireUser);

router.get("/categories", async (req, res) => {
  res.send(await getForumCategories());
});

router.get("/posts", async (req, res) => {
  res.send(await getForumPosts({ categorySlug: req.query.category, search: req.query.search }));
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

  const comment = await createForumComment({
    postId,
    authorId: req.user.user_id,
    parentCommentId,
    body,
  });

  if (!comment) return res.status(400).send({ message: "This conversation is unavailable or locked." });
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

router.post("/posts/:id/report", async (req, res) => {
  const postId = Number(req.params.id);
  const reason = req.body.reason?.trim() || null;

  const report = await reportForumPost(postId, req.user.user_id, reason);
  res.status(201).send({ reported: true, alreadyReported: !report });
});

router.delete("/posts/:id/report", async (req, res) => {
  await unreportForumPost(Number(req.params.id), req.user.user_id);
  res.send({ reported: false });
});

router.post("/posts/:id/comments/:commentId/report", async (req, res) => {
  const commentId = Number(req.params.commentId);
  const reason = req.body.reason?.trim() || null;

  const report = await reportForumComment(commentId, req.user.user_id, reason);
  res.status(201).send({ reported: true, alreadyReported: !report });
});

router.delete("/posts/:id/comments/:commentId/report", async (req, res) => {
  await unreportForumComment(Number(req.params.commentId), req.user.user_id);
  res.send({ reported: false });
});

router.get("/moderation/reports", async (req, res) => {
  if (req.user.role_id > 50) {
    return res.status(403).send({ message: "Moderator access required." });
  }

  const [posts, comments] = await Promise.all([
    getReportedForumPosts(),
    getReportedForumComments(),
  ]);
  res.send({ posts, comments });
});

router.patch("/moderation/reports/posts/:id/resolve", async (req, res) => {
  if (req.user.role_id > 50) {
    return res.status(403).send({ message: "Moderator access required." });
  }

  await resolveForumPostReports(Number(req.params.id), req.user.user_id);
  res.send({ resolved: true });
});

router.patch("/moderation/reports/comments/:id/resolve", async (req, res) => {
  if (req.user.role_id > 50) {
    return res.status(403).send({ message: "Moderator access required." });
  }

  await resolveForumCommentReports(Number(req.params.id), req.user.user_id);
  res.send({ resolved: true });
});

export default router;
