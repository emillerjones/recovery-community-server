import express from "express";
import requireUser from "#middleware/requireUser";
import { getUserByUsername } from "#db/queries/users";
import {
  getConversationForParticipant,
  getConversationsForUser,
  getMessages,
  getOrCreateConversation,
  getUnreadMessageCount,
  markConversationRead,
  sendMessage,
} from "#db/queries/messages";
import { notifyConversation, notifyUser } from "#utils/socket";

const router = express.Router();

router.use(requireUser);

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

router.get("/conversations/:id/messages", async (req, res) => {
  const conversationId = Number(req.params.id);
  const conversation = await getConversationForParticipant(conversationId, req.user.user_id);
  if (!conversation) return res.status(404).send({ message: "Conversation not found." });

  await markConversationRead(conversationId, req.user.user_id);
  res.send(await getMessages(conversationId));
});

router.post("/conversations/:id/messages", async (req, res) => {
  const conversationId = Number(req.params.id);
  const body = req.body.body?.trim();
  if (!body) return res.status(400).send({ message: "A message is required." });

  const conversation = await getConversationForParticipant(conversationId, req.user.user_id);
  if (!conversation) return res.status(404).send({ message: "Conversation not found." });

  const message = await sendMessage({ conversationId, senderId: req.user.user_id, body });

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
