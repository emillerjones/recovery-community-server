import express from "express";
import { recordAnalyticsEvent, validAnalyticsSessionId } from "#utils/analytics";

const router = express.Router();
const EVENT_TYPES = new Set(["logout", "page_view"]);
const PAGE_KEYS = new Set([
  "home", "login", "register", "verify_email", "stories", "community",
  "guidelines", "contact", "discount_links", "about", "resources", "faq",
  "forum", "forum_thread", "messages", "profile", "admin_membership",
  "admin_users", "admin_forum_flags",
]);

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

export default router;
