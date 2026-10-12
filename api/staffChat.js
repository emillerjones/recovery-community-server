import express from "express";
import rateLimit from "express-rate-limit";
import requireUser from "#middleware/requireUser";
import { canUseStaffChat } from "#utils/staffChatAccess";
import { getStaffChatRoom } from "#db/queries/staffChat";
import { createLoungeMessage, getLoungeMessages, getLoungeUnreadCount, markLoungeRead, softDeleteLoungeMessage } from "#db/queries/lounge";
import { notifyStaffChat } from "#utils/socket";

const router = express.Router();
const roomSlug = "staff-chat";
router.use(requireUser);
router.use(async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!canUseStaffChat(req.user)) return res.status(403).send({ message: "Staff access is required." });
  if (!await getStaffChatRoom()) return res.status(503).send({ message: "Staff Chat is unavailable." });
  next();
});

router.get("/unread-count", async (req, res) => {
  res.send({ count: await getLoungeUnreadCount(req.user.user_id, roomSlug) });
});

router.patch("/read", async (req, res) => {
  await markLoungeRead(req.user.user_id, roomSlug);
  res.send({ read: true });
});

router.get("/messages", async (req, res) => {
  const beforeId = req.query.before ? Number(req.query.before) : null;
  if (req.query.before && (!Number.isSafeInteger(beforeId) || beforeId <= 0)) {
    return res.status(400).send({ message: "Invalid message cursor." });
  }
  res.send(await getLoungeMessages({ beforeId, limit: 50, roomSlug }));
});

router.post("/messages", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false }), async (req, res) => {
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body || body.length > 1000) return res.status(400).send({ message: "Messages must be 1–1,000 characters." });
  const message = await createLoungeMessage({ roomSlug, authorId: req.user.user_id, authorUsername: req.user.username, body });
  if (!message) return res.status(503).send({ message: "Staff Chat is unavailable." });
  await notifyStaffChat("staff_chat_message", message);
  res.status(201).send(message);
});

router.delete("/messages/:id", async (req, res) => {
  const messageId = Number(req.params.id);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return res.status(400).send({ message: "Invalid message." });
  const message = await softDeleteLoungeMessage({ roomSlug, messageId, actingUserId: req.user.user_id, canModerate: true });
  if (!message) return res.status(404).send({ message: "Message not found." });
  await notifyStaffChat("staff_chat_message_deleted", message);
  res.send(message);
});

export default router;
