import express from "express";
import requireUser from "#middleware/requireUser";
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "#db/queries/notifications";

const router = express.Router();

router.use(requireUser);

router.get("/", async (req, res) => {
  res.send(await getNotifications(req.user.user_id));
});

router.get("/unread-count", async (req, res) => {
  res.send({ count: await getUnreadNotificationCount(req.user.user_id) });
});

router.patch("/:id/read", async (req, res) => {
  const notification = await markNotificationRead(Number(req.params.id), req.user.user_id);
  if (!notification) return res.status(404).send({ message: "Notification not found." });
  res.send(notification);
});

router.patch("/read-all", async (req, res) => {
  await markAllNotificationsRead(req.user.user_id);
  res.send({ ok: true });
});

export default router;
