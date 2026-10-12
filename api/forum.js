import express from "express";
import requireUser from "#middleware/requireUser";
import db from "#db/client";
import { canUseStaffChat } from "#utils/staffChatAccess";
import { getForumPostAccess, getForumCategoryAccess, getStaffAcknowledgments } from "#utils/forumAccess";
import {
  createForumComment,
  createForumMentions,
  createForumPost,
  createForumTag,
  getForumCategories,
  getForumComments,
  getForumReactionTarget,
  getForumPostById,
  getForumPostHistory,
  getForumPosts,
  getForumTags,
  getStaffAnnouncementsUnreadCount,
  markAllForumPostsRead,
  markForumPostRead,
  getFlaggedForumComments,
  getFlaggedForumPosts,
  flagForumComment,
  flagForumPost,
  reviewForumCommentFlags,
  reviewForumPostFlags,
  followForumPost,
  setForumCommentReaction,
  setForumPostReaction,
  setForumPostTags,
  softDeleteForumComment,
  softDeleteForumPost,
  unflagForumComment,
  unflagForumPost,
  removeForumCommentReaction,
  removeForumPostReaction,
  unfollowForumPost,
  updateForumComment,
  updateForumPost,
  updateForumPostModeration,
  updateForumTag,
} from "#db/queries/forum";
import {
  createNotification,
  createDirectReplyNotification,
  createForumFollowerNotifications,
  createForumParticipantNotifications,
  createOrGroupReactionNotification,
  createStaffFlagNotifications,
} from "#db/queries/notifications";
import { getActiveMentionUsers } from "#db/queries/users";
import { notifyThread, notifyUser } from "#utils/socket";
import {
  closeForumPoll,
  getForumPollForPost,
  getNamedPollVoters,
  removeForumPollVote,
  replaceForumPollVote,
  updateForumPoll,
} from "#db/queries/polls";
import { normalizePollInput } from "#utils/polls";

function parseMediaIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.map(Number))];
  if (ids.length > 4 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null;
  return ids;
}
import { broadcastNewPostAlerts } from "#utils/newPostAlerts";

const router = express.Router();
const REACTION_TYPES = new Set([
  "support",
  "agree",
  "relate",
  "helpful",
  "celebrate",
  "inspiring",
  "care",
]);
const MAX_MENTIONS = 5;

async function notifyStaffOfFlag({ actorId, postId, commentId = null }) {
  // FLAG ALERT TRACE STEP 4: PostgreSQL returns the exact staff alerts it just
  // stored. Push each one to that staff member's private Socket.IO room.
  const notifications = await createStaffFlagNotifications({ actorId, postId, commentId });
  for (const notification of notifications) {
    notifyUser(notification.user_id, "notification", notification);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveMentionUsers(body, requestedUserIds, actorId) {
  // MENTION TRACE STEP 7: Never trust IDs sent by the browser. Normalize and
  // cap them, look up active accounts, and keep a member only if their visible
  // @username truly appears in the submitted text. This blocks hidden pings.
  if (!Array.isArray(requestedUserIds)) return [];
  const uniqueIds = [...new Set(requestedUserIds.map(Number).filter(Number.isInteger))];
  if (uniqueIds.length > MAX_MENTIONS) {
    const error = new Error(`You can mention up to ${MAX_MENTIONS} members.`);
    error.status = 400;
    throw error;
  }

  const users = await getActiveMentionUsers(uniqueIds.filter((id) => id !== actorId));
  return users.filter((user) => {
    const visibleMention = new RegExp(`(^|\\s)@${escapeRegExp(user.username)}(?=\\s|[.,!?;:]|$)`, "i");
    return visibleMention.test(body);
  });
}

async function notifyMentionedUsers({ mentionedUsers, actorId, postId, commentId = null, skipUserIds = [] }) {
  // MENTION TRACE STEP 10: Save and push one alert per mentioned member. The
  // skip list prevents a direct-reply recipient from receiving both a reply
  // alert and a mention alert for the same comment.
  const skipped = new Set([actorId, ...skipUserIds]);
  for (const user of mentionedUsers) {
    if (skipped.has(user.user_id)) continue;
    const notification = await createNotification({
      userId: user.user_id,
      actorId,
      type: commentId ? "mention_in_comment" : "mention_in_post",
      postId,
      commentId,
    });
    notifyUser(user.user_id, "notification", notification);
  }
}

router.use(requireUser);

// One gate covers every post subresource: replies, edits, history, reactions,
// follows, flags and polls. Do not trust a public post ID paired with a private reply ID.
router.use("/posts/:id", async (req, res, next) => {
  if (req.params.id === "read-all") return next();
  const postId = Number(req.params.id);
  if (!Number.isSafeInteger(postId) || postId <= 0) return res.status(400).send({ message: "Invalid post ID." });
  const access = await getForumPostAccess(postId, req.user);
  if (!access) return res.status(404).send({ message: "Post not found or no longer available." });
  const commentMatch = /^\/comments\/([^/]+)/.exec(req.path);
  if (commentMatch) {
    const commentId = Number(commentMatch[1]);
    if (!Number.isSafeInteger(commentId) || commentId <= 0) return res.status(400).send({ message: "Invalid reply ID." });
    const { rowCount } = await db.query("SELECT 1 FROM comments WHERE comment_id = $1 AND post_id = $2", [commentId, postId]);
    if (!rowCount) return res.status(404).send({ message: "Reply not found." });
  }
  req.staffOnly = access.staff_only;
  if (req.staffOnly) res.set("Cache-Control", "no-store");
  next();
});

router.get("/categories", async (req, res) => {
  res.set("X-Staff-Forum-Version", "1");
  res.set("Access-Control-Expose-Headers", "X-Staff-Forum-Version");
  res.set("Cache-Control", "no-store");
  res.send(await getForumCategories({ includeStaff: canUseStaffChat(req.user) }));
});

router.get("/tags", async (req, res) => {
  res.send(await getForumTags({ includeInactive: req.user.role_id <= 50 && req.query.all === "true" }));
});

function tagSlug(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

router.post("/tags", async (req, res) => {
  if (req.user.role_id > 50) return res.status(403).send({ message: "Staff access is required." });
  const name = req.body.name?.trim();
  const slug = tagSlug(req.body.slug || name || "");
  if (!name || !slug || name.length > 40) return res.status(400).send({ message: "Enter a tag name up to 40 characters." });
  const tag = await createForumTag({ name, slug, description: req.body.description, createdBy: req.user.user_id });
  res.status(201).send(tag);
});

router.patch("/tags/:id", async (req, res) => {
  if (req.user.role_id > 50) return res.status(403).send({ message: "Staff access is required." });
  const name = req.body.name?.trim();
  const slug = tagSlug(req.body.slug || name || "");
  if (!name || !slug || name.length > 40 || typeof req.body.active !== "boolean") {
    return res.status(400).send({ message: "Name and active status are required." });
  }
  const tag = await updateForumTag(Number(req.params.id), {
    name, slug, description: req.body.description, active: req.body.active,
  });
  if (!tag) return res.status(404).send({ message: "Tag not found." });
  res.send(tag);
});

router.get("/posts", async (req, res) => {
  const staffView = req.query.section === "staff" || req.query.category === "staff-announcements";
  if (staffView && !canUseStaffChat(req.user)) return res.status(403).send({ message: "Staff access is required." });
  if (staffView) res.set("Cache-Control", "no-store");
  // FORUM LIST TRACE STEP 4: Forum.jsx's GET request arrives here. Turn its
  // URL text into safe, known values; never pass raw filter/order text into
  // SQL. Then hand those choices and the logged-in user ID to getForumPosts().
  const tagSlugs = String(req.query.tags || req.query.tag || "")
    .split(",").map((slug) => slug.trim()).filter(Boolean).slice(0, 10);
  // Old `sort` links remain compatible while the client moves to the clearer
  // scope + order model.
  const legacySort = req.query.sort;
  const scope = ["all", "unread", "mine", "following"].includes(req.query.scope)
    ? req.query.scope
    : (legacySort === "saved" ? "following" : (legacySort === "mine" ? "mine" : "all"));
  const order = ["recent", "discussed"].includes(req.query.order)
    ? req.query.order
    : (legacySort === "discussed" ? "discussed" : "recent");
  const page = Math.max(0, Number.parseInt(req.query.page, 10) || 0);
  // Continue at TRACE STEP 5 in db/queries/forum.js. Its returned object is
  // sent straight back to Forum.jsx as { posts, has_more, next_page }.
  res.send(await getForumPosts({
    categorySlug: req.query.category,
    section: ["announcements", "staff"].includes(req.query.section) ? req.query.section : "community",
    includeStaff: canUseStaffChat(req.user),
    tagSlugs,
    search: req.query.search,
    scope,
    order,
    viewerId: req.user.user_id,
    page,
    limit: 20,
  }));
});

router.get("/staff/unread-count", async (req, res) => {
  if (!canUseStaffChat(req.user)) return res.status(403).send({ message: "Staff access is required." });
  res.set("Cache-Control", "no-store");
  res.send({ count: await getStaffAnnouncementsUnreadCount(req.user.user_id) });
});

router.patch("/posts/read-all", async (req, res) => {
  // READ TRACE STEP 3B: "Mark all read" is authenticated here, then the query
  // records the current read point for every visible conversation.
  const marked = await markAllForumPostsRead(req.user.user_id, req.body?.section === "staff" && canUseStaffChat(req.user));
  res.send({ marked });
});

router.get("/posts/:id", async (req, res) => {
  const post = await getForumPostById(Number(req.params.id), req.user.user_id);
  if (!post) return res.status(404).send({ message: "Post not found." });

  const comments = await getForumComments(post.post_id, req.user.user_id);
  if (req.staffOnly) post.acknowledgments = await getStaffAcknowledgments(post.post_id);
  res.send({ post, comments });
});

router.patch("/posts/:id/read", async (req, res) => {
  // READ TRACE STEP 2: ForumThread calls this after displaying the post. The
  // logged-in identity comes from requireUser, never from browser-submitted ID.
  const read = await markForumPostRead(Number(req.params.id), req.user.user_id);
  if (!read) return res.status(404).send({ message: "Post not found." });
  res.send(read);
});

function sendPollError(res, error) {
  if (error.status) return res.status(error.status).send({ message: error.message });
  throw error;
}

function parsePollId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

router.get("/posts/:id/poll", async (req, res) => {
  const postId = parsePollId(req.params.id);
  if (!postId) return res.status(400).send({ message: "Invalid poll." });
  const poll = await getForumPollForPost(postId, req.user.user_id);
  if (!poll) return res.status(404).send({ message: "Poll not found." });
  res.send(poll);
});

router.put("/posts/:id/poll/vote", async (req, res) => {
  const postId = parsePollId(req.params.id);
  if (!postId) return res.status(400).send({ message: "Invalid poll." });
  const optionIds = Array.isArray(req.body?.option_ids) ? req.body.option_ids : [];
  try {
    const poll = await replaceForumPollVote({ postId, userId: req.user.user_id, optionIds });
    notifyThread(postId, "poll_updated", { post_id: postId });
    res.send(poll);
  } catch (error) {
    return sendPollError(res, error);
  }
});

router.delete("/posts/:id/poll/vote", async (req, res) => {
  const postId = parsePollId(req.params.id);
  if (!postId) return res.status(400).send({ message: "Invalid poll." });
  try {
    const poll = await removeForumPollVote({ postId, userId: req.user.user_id });
    notifyThread(postId, "poll_updated", { post_id: postId });
    res.send(poll);
  } catch (error) {
    return sendPollError(res, error);
  }
});

router.patch("/posts/:id/poll", async (req, res) => {
  const postId = parsePollId(req.params.id);
  if (!postId) return res.status(400).send({ message: "Invalid poll." });
  try {
    const changes = normalizePollInput(req.body?.poll);
    const poll = await updateForumPoll({
      postId,
      actingUserId: req.user.user_id,
      canManageAny: req.staffOnly ? req.user.role_id === 1 : req.user.role_id <= 50,
      poll: changes,
    });
    notifyThread(postId, "poll_updated", { post_id: postId });
    res.send(poll);
  } catch (error) {
    return sendPollError(res, error);
  }
});

router.patch("/posts/:id/poll/close", async (req, res) => {
  const postId = parsePollId(req.params.id);
  if (!postId) return res.status(400).send({ message: "Invalid poll." });
  try {
    const poll = await closeForumPoll({
      postId,
      actingUserId: req.user.user_id,
      canManageAny: req.staffOnly ? req.user.role_id === 1 : req.user.role_id <= 50,
    });
    notifyThread(postId, "poll_updated", { post_id: postId });
    res.send(poll);
  } catch (error) {
    return sendPollError(res, error);
  }
});

router.get("/posts/:id/poll/voters", async (req, res) => {
  const postId = parsePollId(req.params.id);
  const optionId = parsePollId(req.query.optionId);
  if (!postId || !optionId) return res.status(400).send({ message: "Invalid poll choice." });
  const page = Math.min(10000, Math.max(0, Number.parseInt(req.query.page, 10) || 0));
  try {
    res.send(await getNamedPollVoters({
      postId,
      viewerId: req.user.user_id,
      optionId,
      page,
    }));
  } catch (error) {
    return sendPollError(res, error);
  }
});

router.post("/posts", async (req, res) => {
  // CREATE POST TRACE STEP 3: Forum.jsx's POST request arrives here. Validate
  // the form values and use req.user for the real authenticated author; the
  // browser is never trusted to choose author_id or staff permission.
  const categoryId = Number(req.body.category_id);
  const title = req.body.title?.trim();
  const body = req.body.body?.trim();
  const tagIds = [...new Set((Array.isArray(req.body.tag_ids) ? req.body.tag_ids : [])
    .map(Number).filter(Number.isInteger))];
  const mediaIds = parseMediaIds(req.body.media_ids);

  let poll = null;
  if (req.body.poll != null) {
    try {
      poll = normalizePollInput(req.body.poll);
    } catch (error) {
      return res.status(error.status || 400).send({ message: error.message });
    }
  }

  if (!Number.isInteger(categoryId) || !title || !body || tagIds.length > 3 || mediaIds === null) {
    return res.status(400).send({ message: "Category, title, and message are required." });
  }

  const category = await getForumCategoryAccess(categoryId);
  if (!category || (category.staff_only && !canUseStaffChat(req.user))) return res.status(403).send({ message: "That posting destination is unavailable." });
  // An explicit audience stops a stale draft or tampered category from silently
  // publishing private wording to the community (or vice versa).
  if ((req.body.audience === "staff") !== category.staff_only && (category.staff_only || req.body.audience === "staff")) {
    return res.status(400).send({ message: "The post audience does not match its destination. Reopen the correct editor." });
  }
  req.staffOnly = category.staff_only;

  let mentionedUsers;
  try {
    mentionedUsers = await resolveMentionUsers(body, req.body.mentioned_user_ids, req.user.user_id);
  } catch (error) {
    return res.status(error.status || 400).send({ message: error.message });
  }

  // MENTION TRACE STEP 8A: The server has validated the selected members.
  // Save the normal forum post first, then connect its new ID to mention rows.
  // CREATE POST TRACE STEP 4: Hand the validated values to the database query.
  // Continue at TRACE STEP 5 in db/queries/forum.js.
  let post;
  try {
    post = await createForumPost({
      categoryId,
      authorId: req.user.user_id,
      title,
      body,
      mediaIds,
      canPostAnnouncements: req.user.role_id <= 50,
      poll,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).send({ message: error.message });
    throw error;
  }

  if (!post) return res.status(400).send({ message: "That category is unavailable." });
  try {
    // TAG TRACE: the post keeps its structural category; these rows attach up
    // to three staff-approved descriptors without creating new categories.
    post.tags = await setForumPostTags(post.post_id, tagIds);
  } catch (error) {
    console.error("Failed to attach tags to new forum post:", error);
    post.tags = [];
  }
  let savedMentions = [];
  if (req.staffOnly) return res.status(201).send(post);
  try {
    savedMentions = await createForumMentions({
      mentionedUsers,
      mentionedBy: req.user.user_id,
      postId: post.post_id,
    });
  } catch (error) {
    // The post already exists. Do not return a failure that could make the
    // browser retry and create a duplicate post.
    console.error("Failed to save new-post mentions:", error);
  }
  post.mentions = savedMentions.map((mention) => ({
    user_id: mention.mentioned_user_id,
    username: mention.username_snapshot,
  }));
  try {
    const savedIds = new Set(savedMentions.map((mention) => mention.mentioned_user_id));
    await notifyMentionedUsers({
      mentionedUsers: mentionedUsers.filter((user) => savedIds.has(user.user_id)),
      actorId: req.user.user_id,
      postId: post.post_id,
    });
  } catch (error) {
    console.error("Failed to create new-post mention notification:", error);
  }
  try {
    // NEW POST ALERT TRACE STEP 2: inserting the post fired the database trigger
    // that stored an alert for every member; now push those rows to online users.
    await broadcastNewPostAlerts(post.post_id);
  } catch (error) {
    // The alerts are already durable in PostgreSQL. A socket failure must not
    // make the browser retry and accidentally create a second forum post.
    console.error("Failed to broadcast new-post notifications:", error);
  }
  // CREATE POST TRACE STEP 6: Return PostgreSQL's new post object (including
  // post_id) to Forum.jsx, which navigates to that new thread.
  res.status(201).send(post);
});

router.post("/posts/:id/comments", async (req, res) => {
  const postId = Number(req.params.id);
  const body = req.body.body?.trim();
  const parentCommentId = req.body.parent_comment_id == null
    ? null
    : Number(req.body.parent_comment_id);
  const mediaIds = parseMediaIds(req.body.media_ids);

  if (!Number.isInteger(postId) || !body || mediaIds === null) {
    return res.status(400).send({ message: "A reply is required." });
  }
  if (parentCommentId !== null && !Number.isInteger(parentCommentId)) {
    return res.status(400).send({ message: "Invalid parent comment." });
  }

  let mentionedUsers;
  try {
    mentionedUsers = await resolveMentionUsers(body, req.body.mentioned_user_ids, req.user.user_id);
  } catch (error) {
    return res.status(error.status || 400).send({ message: error.message });
  }

  // TRACE STEP 1: Save the member's reply in the comments table first.
  // createForumComment() contains the SQL and returns the newly saved row.
  let comment;
  try {
    comment = await createForumComment({
      postId,
      authorId: req.user.user_id,
      parentCommentId,
      body,
      mediaIds,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).send({ message: error.message });
    throw error;
  }

  // If the post is missing, deleted, or locked, no comment was created.
  // Stop here so we do not try to notify anyone about a reply that does not exist.
  if (!comment) return res.status(400).send({ message: "This conversation is unavailable or locked." });
  if (req.staffOnly) {
    await notifyThread(postId, "new_comment", comment);
    return res.status(201).send(comment);
  }

  // MENTION TRACE STEP 8B: The reply has its permanent comment ID now, so its
  // verified mentioned members can be connected to that exact reply.
  let savedMentions = [];
  try {
    savedMentions = await createForumMentions({
      mentionedUsers,
      mentionedBy: req.user.user_id,
      commentId: comment.comment_id,
    });
  } catch (error) {
    // As with reply notifications, a secondary mention failure must not make
    // the client retry a reply that PostgreSQL already saved.
    console.error("Failed to save reply mentions:", error);
  }
  comment.mentions = savedMentions.map((mention) => ({
    user_id: mention.mentioned_user_id,
    username: mention.username_snapshot,
  }));

  notifyThread(postId, "new_comment", comment);

  try {
    // OWNER-APPROVED NOTIFICATION SPLIT:
    // - A direct comment alerts the OG poster, original-post reactors, and
    //   other direct commenters.
    // - A nested reply alerts only the exact parent-comment author.
    const participantNotifications = parentCommentId
      ? []
      : await createForumParticipantNotifications({
        actorId: req.user.user_id,
        postId,
        commentId: comment.comment_id,
        activity: "comment",
      });
    const replyNotification = parentCommentId
      ? await createDirectReplyNotification({
        actorId: req.user.user_id,
        postId,
        parentCommentId,
        commentId: comment.comment_id,
      })
      : null;

    // Every returned row is already durable. Socket.IO mirrors it immediately
    // for recipients who happen to be online.
    for (const notification of participantNotifications) {
      notifyUser(notification.user_id, "notification", notification);
    }
    if (replyNotification) {
      notifyUser(replyNotification.user_id, "notification", replyNotification);
    }

    const alreadyNotifiedIds = [
      ...participantNotifications.map((notification) => notification.user_id),
      ...(replyNotification ? [replyNotification.user_id] : []),
    ];
    const followerNotifications = await createForumFollowerNotifications({
      actorId: req.user.user_id,
      postId,
      commentId: comment.comment_id,
      skipUserIds: alreadyNotifiedIds,
    });
    for (const notification of followerNotifications) {
      notifyUser(notification.user_id, "notification", notification);
    }

    const savedIds = new Set(savedMentions.map((mention) => mention.mentioned_user_id));
    await notifyMentionedUsers({
      mentionedUsers: mentionedUsers.filter((user) => savedIds.has(user.user_id)),
      actorId: req.user.user_id,
      postId,
      commentId: comment.comment_id,
      // Do not give the same person an activity alert plus a mention alert.
      skipUserIds: [
        ...alreadyNotifiedIds,
        ...followerNotifications.map((notification) => notification.user_id),
      ],
    });
  } catch (error) {
    // The reply is already saved. A notification failure should not make
    // the client retry the reply and accidentally create a duplicate.
    console.error("Failed to create forum reply notification:", error);
  }

  res.status(201).send(comment);
});

router.get("/posts/:id/history", async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isSafeInteger(postId) || postId <= 0) return res.status(400).send({ message: "Invalid post ID." });
  const post = await getForumPostById(postId, req.user.user_id);
  if (!post) return res.status(404).send({ message: "Post not found." });
  res.set("Cache-Control", "no-store");
  res.send(await getForumPostHistory(postId));
});

router.patch("/posts/:id", async (req, res) => {
  const postId = Number(req.params.id);
  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  const body = typeof req.body.body === "string" ? req.body.body.trim() : "";

  if (!Number.isSafeInteger(postId) || postId <= 0 || title.length > 180) {
    return res.status(400).send({ message: "Invalid post ID or title (maximum 180 characters)." });
  }

  if (!title && !body) {
    return res.status(400).send({ message: "Nothing to update." });
  }

  // Approved members can edit their own original posts. Only the owner may
  // edit someone else's wording. Comment editing keeps its separate policy.
  const canEditOwn = true;
  const canEditOthers = req.user.role_id === 1;

  // EDIT HISTORY TRACE STEP 3: the query snapshots the current wording into
  // revision table before applying the edit; post readers may view that history.
  const post = await updateForumPost(postId, req.user.user_id, canEditOwn, canEditOthers, { title, body });
  if (!post) return res.status(404).send({ message: "Post not found, unchanged, or you do not have permission to edit it." });
  res.send(post);
});

router.patch("/posts/:id/comments/:commentId", async (req, res) => {
  const postId = Number(req.params.id);
  const commentId = Number(req.params.commentId);
  const body = req.body.body?.trim();

  if (!Number.isInteger(postId) || !Number.isInteger(commentId) || !body) {
    return res.status(400).send({ message: "A reply is required." });
  }
  const canEditOwn = req.user.role_id <= 50;
  if (!canEditOwn) {
    return res.status(403).send({ message: "Published replies cannot be edited by members." });
  }

  // COMMENT EDIT TRACE STEP 3: moderator/admin may edit only their own reply;
  // owner may edit anyone's. Continue in db/queries/forum.js.
  const comment = await updateForumComment(
    postId,
    commentId,
    req.user.user_id,
    canEditOwn,
    req.user.role_id === 1,
    body
  );
  if (!comment) {
    return res.status(404).send({ message: "Reply not found, unchanged, or you do not have permission to edit it." });
  }
  res.send(comment);
});

router.delete("/posts/:id", async (req, res) => {
  const postId = Number(req.params.id);
  const canDeleteOthers = req.user.role_id <= 10;

  // DELETE TRACE STEP 2A: members and moderators may delete only their own
  // post. Owner/admin is the only staff exception allowed to delete another
  // member's post. The query also soft-deletes every reply under that post.
  const post = await softDeleteForumPost(postId, req.user.user_id, canDeleteOthers);
  if (!post) return res.status(404).send({ message: "Post not found or you do not have permission to delete it." });
  res.send(post);
});

router.delete("/posts/:id/comments/:commentId", async (req, res) => {
  const postId = Number(req.params.id);
  const commentId = Number(req.params.commentId);
  const canDeleteOthers = req.user.role_id <= 10;

  // DELETE TRACE STEP 2B: the same permission rule applies to comments. The
  // recursive query removes this reply and every generation below it.
  const comment = await softDeleteForumComment(postId, commentId, req.user.user_id, canDeleteOthers);
  if (!comment) return res.status(404).send({ message: "Reply not found or you do not have permission to delete it." });
  res.send(comment);
});

router.patch("/posts/:id/moderation", async (req, res) => {
  if (req.staffOnly && ![1,10].includes(req.user.role_id)) return res.status(403).send({ message: "Owner or administrator access is required to pin or lock staff announcements." });
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
  try {
    // FLAG ALERT TRACE STEP 2A: only a newly saved flag reaches this point.
    await notifyStaffOfFlag({ actorId: req.user.user_id, postId });
  } catch (error) {
    console.error("Failed to notify staff about a flagged post:", error);
  }
  res.status(201).send({ flagged: true });
});

router.delete("/posts/:id/flag", async (req, res) => {
  await unflagForumPost(Number(req.params.id), req.user.user_id);
  res.send({ flagged: false });
});

router.post("/posts/:id/follow", async (req, res) => {
  await followForumPost(Number(req.params.id), req.user.user_id);
  res.status(201).send({ following: true });
});

router.delete("/posts/:id/follow", async (req, res) => {
  await unfollowForumPost(Number(req.params.id), req.user.user_id);
  res.send({ following: false });
});

// Temporary compatibility for an already-deployed client using the old name.
router.post("/posts/:id/save", async (req, res) => {
  await followForumPost(Number(req.params.id), req.user.user_id);
  res.status(201).send({ saved: true, following: true });
});

router.delete("/posts/:id/save", async (req, res) => {
  await unfollowForumPost(Number(req.params.id), req.user.user_id);
  res.send({ saved: false, following: false });
});

async function notifyReactionRecipients({ req, postId, commentId = null }) {
  if (req.staffOnly) return;
  // REACTION TRACE STEP 6: A brand-new reaction reaches this helper after the
  // database save. Changes to an existing reaction deliberately skip alerts.
  // Reactions on the original post alert every existing participant. The new
  // reactor is already part of that set after the save, but the query excludes
  // the actor. Reactions on an individual reply remain private to its author.
  if (!commentId) {
    const notifications = await createForumParticipantNotifications({
      actorId: req.user.user_id,
      postId,
      activity: "reaction",
    });
    for (const notification of notifications) {
      notifyUser(notification.user_id, "notification", notification);
    }
    return;
  }

  const target = await getForumReactionTarget({ postId, commentId });
  if (!target || target.author_id === req.user.user_id) return;

  const notification = await createOrGroupReactionNotification({
    userId: target.author_id,
    actorId: req.user.user_id,
    postId: target.post_id,
    commentId: target.comment_id,
  });
  notifyUser(target.author_id, "notification", notification);
}

router.put("/posts/:id/reaction", async (req, res) => {
  // REACTION TRACE STEP 4A: PUT requests from togglePostReaction() arrive
  // here. Validate the URL ID and the reaction name before touching the DB.
  const postId = Number(req.params.id);
  const reactionType = req.body.reaction_type;
  if (!Number.isInteger(postId) || !REACTION_TYPES.has(reactionType)) {
    return res.status(400).send({ message: "Choose a valid reaction." });
  }

  // Continue at REACTION TRACE STEP 5A in db/queries/forum.js. These three
  // values identify the post, logged-in member, and selected reaction.
  const reaction = await setForumPostReaction(postId, req.user.user_id, reactionType);
  if (!reaction) return res.status(404).send({ message: "Post not found." });
  try { if (reaction.was_new) await notifyReactionRecipients({ req, postId }); }
  catch (error) { console.error("Failed to create post reaction notification:", error); }
  // Return to REACTION TRACE STEP 7A in client ForumThread.jsx.
  res.send({ reaction_type: reaction.reaction_type });
});

router.delete("/posts/:id/reaction", async (req, res) => {
  // REACTION TRACE STEP 4C: Clicking the active post reaction sends DELETE
  // here instead of PUT. The query removes that member's one reaction row.
  await removeForumPostReaction(Number(req.params.id), req.user.user_id);
  // Return to REACTION TRACE STEP 7A in client ForumThread.jsx.
  res.send({ reaction_type: null });
});

router.put("/posts/:id/comments/:commentId/reaction", async (req, res) => {
  // REACTION TRACE STEP 4B: PUT requests from toggleCommentReaction() arrive
  // here. The post ID keeps the route inside its thread; commentId identifies
  // the exact reply that will receive the reaction.
  const commentId = Number(req.params.commentId);
  const reactionType = req.body.reaction_type;
  if (!Number.isInteger(commentId) || !REACTION_TYPES.has(reactionType)) {
    return res.status(400).send({ message: "Choose a valid reaction." });
  }

  // Continue at REACTION TRACE STEP 5B in db/queries/forum.js.
  const reaction = await setForumCommentReaction(commentId, req.user.user_id, reactionType);
  if (!reaction) return res.status(404).send({ message: "Reply not found." });
  try { if (reaction.was_new) await notifyReactionRecipients({ req, postId: Number(req.params.id), commentId }); }
  catch (error) { console.error("Failed to create reply reaction notification:", error); }
  // Return to REACTION TRACE STEP 7B in client ForumThread.jsx.
  res.send({ reaction_type: reaction.reaction_type });
});

router.delete("/posts/:id/comments/:commentId/reaction", async (req, res) => {
  // REACTION TRACE STEP 4D: Clicking the active reply reaction sends DELETE
  // here, which removes the matching row through the DB query file.
  await removeForumCommentReaction(Number(req.params.commentId), req.user.user_id);
  // Return to REACTION TRACE STEP 7B in client ForumThread.jsx.
  res.send({ reaction_type: null });
});

router.post("/posts/:id/comments/:commentId/flag", async (req, res) => {
  const commentId = Number(req.params.commentId);
  const reason = req.body.reason?.trim() || null;

  const flag = await flagForumComment(commentId, req.user.user_id, reason);
  if (!flag) return res.status(400).send({ message: "This content cannot be flagged or is already flagged by you." });
  try {
    // FLAG ALERT TRACE STEP 2B: link staff directly to this reply in its post.
    await notifyStaffOfFlag({
      actorId: req.user.user_id,
      postId: flag.post_id,
      commentId,
    });
  } catch (error) {
    console.error("Failed to notify staff about a flagged reply:", error);
  }
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
