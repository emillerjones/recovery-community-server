import express from "express";
import rateLimit from "express-rate-limit";
import requireUser from "#middleware/requireUser";
import { getTodayGrove, toggleCheckinSupport, upsertTodayCheckin } from "#db/queries/grove";
import { notifyCommunity } from "#utils/socket";

const router = express.Router();
router.use(requireUser);

const MOODS = new Set(["steady", "hopeful", "one_day", "difficult", "support", "celebrating"]);
const participationLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 80,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

function communityDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  if (Math.abs(Date.now() - parsed.getTime()) > 48 * 60 * 60_000) return null;
  return value;
}

router.get("/today", async (req, res) => {
  const checkinDate = communityDate(req.query.date);
  if (!checkinDate) return res.status(400).send({ message: "Invalid check-in date." });
  res.send(await getTodayGrove(req.user.user_id, checkinDate));
});

router.post("/check-in", participationLimiter, async (req, res) => {
  const mood = typeof req.body?.mood === "string" ? req.body.mood : "";
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  const openToSupport = req.body?.open_to_support === true;
  const checkinDate = communityDate(req.body?.checkin_date);
  if (!checkinDate) return res.status(400).send({ message: "Invalid check-in date." });
  if (!MOODS.has(mood)) return res.status(400).send({ message: "Choose how you are arriving today." });
  if (note.length > 180) return res.status(400).send({ message: "Check-in notes must be 180 characters or fewer." });

  const checkin = await upsertTodayCheckin({
    userId: req.user.user_id,
    checkinDate,
    mood,
    note,
    openToSupport: mood === "support" ? true : openToSupport,
  });
  notifyCommunity("grove_checkin_updated", checkin);
  res.status(201).send(checkin);
});

router.post("/check-ins/:id/support", participationLimiter, async (req, res) => {
  const checkinId = Number(req.params.id);
  if (!Number.isSafeInteger(checkinId) || checkinId <= 0) {
    return res.status(400).send({ message: "Invalid check-in." });
  }
  const result = await toggleCheckinSupport({ checkinId, userId: req.user.user_id });
  if (!result) return res.status(400).send({ message: "That check-in cannot be supported." });
  notifyCommunity("grove_support_updated", { ...result, actor_user_id: req.user.user_id });
  res.send(result);
});

export default router;
