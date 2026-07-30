import express from "express";
import rateLimit from "express-rate-limit";
import requireUser from "#middleware/requireUser";
import {
  createLoungeMessage,
  getLoungeMessages,
  getLoungeStatus,
  markLoungeRead,
  softDeleteLoungeMessage,
} from "#db/queries/lounge";
import { getOnlineUserCount, notifyLounge } from "#utils/socket";

const router = express.Router();
router.use(requireUser);

const messageLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

router.get("/status", async (req, res) => {
  const status = await getLoungeStatus(req.user.user_id);
  res.send({ ...status, online_count: getOnlineUserCount() });
});

router.get("/messages", async (req, res) => {
  const beforeId = req.query.before ? Number(req.query.before) : null;
  if (req.query.before && (!Number.isSafeInteger(beforeId) || beforeId <= 0)) {
    return res.status(400).send({ message: "Invalid Lounge message cursor." });
  }
  res.send(await getLoungeMessages({ beforeId, limit: 50 }));
});

router.post("/messages", messageLimiter, async (req, res) => {
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body || body.length > 1000) {
    return res.status(400).send({ message: "Lounge messages must be 1–1,000 characters." });
  }

  const message = await createLoungeMessage({
    authorId: req.user.user_id,
    authorUsername: req.user.username,
    body,
  });
  if (!message) return res.status(503).send({ message: "The Community Lounge is unavailable." });
  notifyLounge("lounge_message", message);
  res.status(201).send(message);
});

router.patch("/read", async (req, res) => {
  await markLoungeRead(req.user.user_id);
  res.send({ read: true });
});

router.delete("/messages/:id", async (req, res) => {
  const messageId = Number(req.params.id);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    return res.status(400).send({ message: "Invalid Lounge message." });
  }
  const deleted = await softDeleteLoungeMessage({
    messageId,
    actingUserId: req.user.user_id,
    canModerate: req.user.role_id <= 50,
  });
  if (!deleted) return res.status(403).send({ message: "You cannot delete that message." });
  notifyLounge("lounge_message_deleted", deleted);
  res.send(deleted);
});

export default router;
