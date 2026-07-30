import geoip from "geoip-lite";
import { createAnalyticsEvent } from "#db/queries/analytics";

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validAnalyticsSessionId(value) {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

function deviceTypeFromRequest(req) {
  const userAgent = req.get("user-agent") || "";
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) return "tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(userAgent)) return "mobile";
  return "desktop";
}

function coarseLocationFromRequest(req) {
  // Express resolves req.ip through Render's one trusted proxy. geoip-lite
  // works locally; the raw IP is neither sent elsewhere nor stored by us.
  const ip = String(req.ip || "").replace(/^::ffff:/, "");
  const location = geoip.lookup(ip);
  return {
    countryCode: location?.country || null,
    region: location?.region || null,
  };
}

export async function recordAnalyticsEvent(req, {
  userId = req.user?.user_id || null,
  sessionId,
  eventType,
  pageKey = null,
}) {
  const { countryCode, region } = coarseLocationFromRequest(req);
  return createAnalyticsEvent({
    userId,
    sessionId,
    eventType,
    pageKey,
    deviceType: deviceTypeFromRequest(req),
    countryCode,
    region,
  });
}
