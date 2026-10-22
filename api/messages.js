import express from "express";
import requireUser from "#middleware/requireUser";
import { getUserByUsername } from "#db/queries/users";
import {
  getConversationForParticipant,
  getConversationsForUser,
  getMessageableMembers,
  getMessages,
  getOrCreateConversation,
  getUnreadMessageCount,
  markConversationRead,
  sendMessage,
} from "#db/queries/messages";
import { notifyConversation, notifyUser } from "#utils/socket";

const router = express.Router();

router.use(requireUser);

function parseMediaIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const ids = value.map(Number);
  if (ids.length > 4
      || new Set(ids).size !== ids.length
      || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null;
  return ids;
}

router.get("/members", async (req, res) => {
  // NEW MESSAGE PICKER TRACE STEP 3: Any authenticated member may use this
  // privacy-safe directory. The query returns only ID, username, and avatar.
  res.send(await getMessageableMembers(req.user.user_id));
});

router.get("/conversations", async (req, res) => {
  res.send(await getConversationsForUser(req.user.user_id));
});

router.get("/unread-count", async (req, res) => {
  res.send({ count: await getUnreadMessageCount(req.user.user_id) });
});

router.post("/conversations", async (req, res) => {
  const username = req.body.username?.trim().toLowerCase();
  if (!username) return res.status(400).send({ message: "A username is required." });

  const otherUser = await getUserByUsername(username);
  if (!otherUser) return res.status(404).send({ message: "No member with that username." });
  if (otherUser.user_id === req.user.user_id) {
    return res.status(400).send({ message: "You can't message yourself." });
  }

  const conversation = await getOrCreateConversation(req.user.user_id, otherUser.user_id);
  res.status(201).send(conversation);
});

const FIRST_PAGE_SIZE = 100;
const OLDER_PAGE_SIZE = 50;

router.get("/conversations/:id/messages", async (req, res) => {
  const conversationId = Number(req.params.id);
  const before = req.query.before == null ? null : Number(req.query.before);
  if (before !== null && (!Number.isSafeInteger(before) || before <= 0)) {
    return res.status(400).send({ message: "Invalid message cursor." });
  }

  const conversation = await getConversationForParticipant(conversationId, req.user.user_id);
  if (!conversation) return res.status(404).send({ message: "Conversation not found." });

  // Only opening the conversation marks it read; paging back through history does not.
  if (before === null) await markConversationRead(conversationId, req.user.user_id);

  // Ask for one extra row to learn whether older messages remain.
  const pageSize = before === null ? FIRST_PAGE_SIZE : OLDER_PAGE_SIZE;
  const rows = await getMessages(conversationId, pageSize + 1, before);
  const hasMore = rows.length > pageSize;
  res.send({ messages: hasMore ? rows.slice(1) : rows, has_more: hasMore });
});

router.post("/conversations/:id/messages", async (req, res) => {
  const conversationId = Number(req.params.id);
  const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
  const mediaIds = parseMediaIds(req.body.media_ids);
  if (mediaIds === null) return res.status(400).send({ message: "Choose up to four valid photos." });
  if (!body && !mediaIds.length) {
    return res.status(400).send({ message: "A message or photo is required." });
  }

  const conversation = await getConversationForParticipant(conversationId, req.user.user_id);
  if (!conversation) return res.status(404).send({ message: "Conversation not found." });

  let message;
  try {
    message = await sendMessage({
      conversationId,
      senderId: req.user.user_id,
      body,
      mediaIds,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).send({ message: error.message });
    throw error;
  }

  const recipientId = conversation.user_one_id === req.user.user_id
    ? conversation.user_two_id
    : conversation.user_one_id;

  notifyConversation(conversationId, "new_message", message);
  notifyUser(recipientId, "dm_notification", { conversationId, message });

  res.status(201).send(message);
});

router.patch("/conversations/:id/read", async (req, res) => {
  const conversationId = Number(req.params.id);
  const conversation = await getConversationForParticipant(conversationId, req.user.user_id);
  if (!conversation) return res.status(404).send({ message: "Conversation not found." });

  await markConversationRead(conversationId, req.user.user_id);
  res.send({ ok: true });
});

export default router;
