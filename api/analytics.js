import express from "express";
import { recordAnalyticsEvent, validAnalyticsSessionId } from "#utils/analytics";
import requireUser from "#middleware/requireUser";
import { getAnalyticsEvents, getAnalyticsSummary } from "#db/queries/analytics";

const router = express.Router();
const EVENT_TYPES = new Set(["logout", "page_view"]);
const PAGE_KEYS = new Set([
  "home", "login", "register", "verify_email", "stories", "community",
  "guidelines", "contact", "discount_links", "about", "resources", "faq",
  "forum", "forum_thread", "messages", "profile", "admin_membership",
  "admin_users", "admin_forum_flags",
  "admin_stats",
]);
const ADMIN_EVENT_TYPES = new Set(["login", "logout", "page_view"]);

function ownerOnly(req, res, next) {
  if (req.user.role_id !== 1) {
    return res.status(403).send({ message: "Owner access is required." });
  }
  next();
}

function analyticsRange(req, res) {
  const endAt = new Date(req.query.end);
  const startAt = new Date(req.query.start);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt >= endAt) {
    res.status(400).send({ message: "Choose a valid analytics date range." });
    return null;
  }
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

router.post("/events", async (req, res) => {
  const eventType = req.body?.eventType;
  const pageKey = req.body?.pageKey || null;
  const sessionId = req.body?.sessionId;

  if (!EVENT_TYPES.has(eventType) || !validAnalyticsSessionId(sessionId)) {
    return res.status(400).send({ message: "Invalid analytics event." });
  }
  if (eventType === "page_view" && !PAGE_KEYS.has(pageKey)) {
    return res.status(400).send({ message: "Unknown analytics page." });
  }
  if (eventType === "logout" && !req.user) {
    return res.status(401).send({ message: "Authentication required." });
  }

  // ANALYTICS TRACE: getUserFromToken has already attached the logged-in user
  // when present. Location/device are derived on the server, not trusted from
  // browser input, and the raw IP is discarded after the coarse lookup.
  await recordAnalyticsEvent(req, { sessionId, eventType, pageKey });
  res.status(201).send({ recorded: true });
});

router.get("/admin/summary", requireUser, ownerOnly, async (req, res) => {
  const range = analyticsRange(req, res);
  if (!range) return;
  res.send(await getAnalyticsSummary(range));
});

router.get("/admin/events", requireUser, ownerOnly, async (req, res) => {
  const range = analyticsRange(req, res);
  if (!range) return;

  const eventType = req.query.type || null;
  if (eventType && !ADMIN_EVENT_TYPES.has(eventType)) {
    return res.status(400).send({ message: "Unknown analytics event type." });
  }
  const beforeId = req.query.before ? Number(req.query.before) : null;
  if (req.query.before && (!Number.isSafeInteger(beforeId) || beforeId <= 0)) {
    return res.status(400).send({ message: "Invalid analytics cursor." });
  }

  res.send(await getAnalyticsEvents({ ...range, eventType, beforeId, limit: 20 }));
});

export default router;
